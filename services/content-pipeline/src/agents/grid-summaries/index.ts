import { GridSummaryError } from "./errors.js";
export { GridSummaryError } from "./errors.js";
import { generateContent } from "../../lib/ai.js";
import { DEFAULT_CLAUDE_MODEL } from "../../lib/models.js";
import type { AgentConfig } from "../../lib/config.js";
import { clearTreeCache, commitBatch, createOctokit, readFile } from "../../lib/github.js";
import { credentialsFor, getKVEntry } from "../../lib/kv.js";
import { getKvNamespaces } from "../../lib/cloudflare-accounts.js";
import { recordTextUsage } from "../../costs/recorder.js";
import { decideAction, sha256, type SummaryAction } from "./decide.js";
import { parseSummaryFile, serializeSummaryFile, summaryPath, type SummaryFrontmatter } from "./files.js";
import { SUMMARY_SYSTEM_PROMPT, articleText, buildUserPrompt, isValidSummary, sanitizeSummaryMarkdown } from "./prompt.js";
import { isAiGridConfig, parseDashboardIndex, poolUrlFor } from "./targets.js";
import type { ArticleRecordLike, PoolLike } from "./types.js";

const STAGING_WORKER_URL = process.env.GRID_STAGING_WORKER_URL ?? "https://atomic-site-worker-staging.accounts-4a8.workers.dev";
const DEFAULT_RUN_CAP = 150;
// Note: undefined → the CloudGrid gateway / SDK default model. Set GRID_SUMMARY_MODEL to a cheaper id
// that is valid on BOTH the gateway and the Anthropic SDK (see src/lib/ai.ts fallback).

/** Injectable I/O so tests never hit the network. */
export interface GridSummariesDeps {
  now: () => Date;
  fetchPool: (url: string) => Promise<PoolLike>;
  readKv: (domain: string, key: string, env: "prod" | "staging") => Promise<unknown>;
}

/** Counters for one run (logged and returned). */
export interface GridSummariesResult {
  targets: number;
  needed: number;
  generated: number;
  regenerated: number;
  flagged: number;
  skipped: number;
  failed: number;
  capped: boolean;
  commits: number;
}

function defaultDeps(): GridSummariesDeps {
  return {
    now: () => new Date(),
    fetchPool: async (url) => {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`pool ${url} → ${res.status}`);
      return (await res.json()) as PoolLike;
    },
    readKv: (domain, key, env) => getKVEntry(getKvNamespaces(domain)[env], key, credentialsFor(domain)),
  };
}

async function readArticle(deps: GridSummariesDeps, site: string, slug: string): Promise<ArticleRecordLike | null> {
  const key = `article:${site}:${slug}`;
  const rec = ((await deps.readKv(site, key, "prod")) ?? (await deps.readKv(site, key, "staging"))) as ArticleRecordLike | null;
  return rec && typeof rec.body === "string" && rec.frontmatter?.status === "published" ? rec : null;
}

/** readFile's exact "not found" wording (src/lib/github.ts resolveBlobSha) — anything else is a real error. */
function isMissingFileError(err: unknown): boolean {
  return err instanceof Error && /^Expected file at .*, got nothing$/.test(err.message);
}

/** Null only for a genuinely missing summary file; any other read error (rate limit, GitHub blip,
 * malformed content) is rethrown so the caller counts it as failed instead of silently treating an
 * existing — possibly hand-edited — summary as absent and regenerating over it. */
async function readExisting(octokit: ReturnType<typeof createOctokit>, repo: string, site: string, slug: string): Promise<{ fm: SummaryFrontmatter; markdown: string } | null> {
  try {
    return parseSummaryFile(await readFile(octokit, repo, summaryPath(site, slug), "main"));
  } catch (err) {
    if (isMissingFileError(err)) return null;
    throw err;
  }
}

async function generateSummary(site: string, title: string, body: string): Promise<{ markdown: string; model: string }> {
  const model = process.env.GRID_SUMMARY_MODEL;
  const result = await generateContent({
    systemPrompt: SUMMARY_SYSTEM_PROMPT,
    userPrompt: buildUserPrompt(title, articleText(body)),
    ...(model ? { model } : {}),
    maxTokens: 900,
  });
  // The chain may fall back to another provider — record what actually ran.
  const usedModel = result.model ?? model ?? DEFAULT_CLAUDE_MODEL;
  void recordTextUsage({
    siteDomain: site,
    source: "grid-summaries",
    model: usedModel,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    estimated: result.usage.estimated,
  });
  const markdown = sanitizeSummaryMarkdown(result.text);
  if (!isValidSummary(markdown)) throw new Error("summary failed structure/length validation");
  return { markdown, model: usedModel };
}

/** One file this run decided to write, held until the pre-commit re-check (step 4) confirms it's still safe. */
interface PlannedFile {
  site: string;
  slug: string;
  path: string;
  content: string;
  action: SummaryAction;
  /** existing.fm.edited_at as seen at planning time (null when there was no existing edited file). */
  plannedEditedAt: string | null;
  /** The summary file's state as seen at planning time (null when it was missing) — any change by commit time drops a generate/regenerate. */
  plannedFrom: { bodyHash: string; generatedAt: string } | null;
}

/** Planning-time snapshot of an existing summary file (null when missing). */
function snapshotOf(existing: { fm: SummaryFrontmatter } | null): PlannedFile["plannedFrom"] {
  return existing ? { bodyHash: existing.fm.body_hash, generatedAt: existing.fm.generated_at } : null;
}

/** Why a planned file must be dropped at the pre-commit re-check, or null when it is still safe to write. */
function staleReason(file: PlannedFile, current: { fm: SummaryFrontmatter } | null): string | null {
  if (file.action === "flag_source_changed") {
    // Only flag the exact edit we planned against. If it was regenerated (edited now false) or re-edited, drop.
    return current?.fm.edited === true && current.fm.edited_at === file.plannedEditedAt ? null : "changed after this run planned the flag";
  }
  if (current?.fm.edited) return "hand-edited after this run planned it";
  if (!current) return null;
  if (!file.plannedFrom) return "created after this run planned it";
  if (current.fm.body_hash !== file.plannedFrom.bodyHash || current.fm.generated_at !== file.plannedFrom.generatedAt) return "rewritten after this run planned it";
  return null;
}

function freshFrontmatter(site: string, slug: string, bodyHash: string, model: string, now: Date): SummaryFrontmatter {
  return { source_site: site, slug, body_hash: bodyHash, generated_at: now.toISOString(), model, edited: false, edited_by: null, edited_at: null, source_changed: false };
}

/** One hourly run (spec "Summary generation"). Never throws for per-article problems. */
export async function runGridSummaries(config: AgentConfig, deps: GridSummariesDeps = defaultDeps()): Promise<GridSummariesResult> {
  const result: GridSummariesResult = { targets: 0, needed: 0, generated: 0, regenerated: 0, flagged: 0, skipped: 0, failed: 0, capped: false, commits: 0 };
  const cap = Number(process.env.GRID_SUMMARY_RUN_CAP ?? DEFAULT_RUN_CAP) || DEFAULT_RUN_CAP;
  const octokit = createOctokit(config.github);
  clearTreeCache("main");
  const entries = parseDashboardIndex(await readFile(octokit, config.networkRepo, "dashboard-index.yaml", "main")).filter((e) => !e.deleted);

  // 1. AI-mode Grid sites (resolved config from prod KV when Live, staging otherwise).
  const pools: PoolLike[] = [];
  for (const entry of entries) {
    const cfg = await deps.readKv(entry.domain, `site-config:${entry.domain}`, entry.status === "live" ? "prod" : "staging").catch((err: unknown) => {
      console.error(`[grid-summaries] config read failed for ${entry.domain}:`, err instanceof Error ? err.message : err);
      return null;
    });
    if (!isAiGridConfig(cfg)) continue;
    result.targets++;
    try {
      pools.push(await deps.fetchPool(poolUrlFor(entry, { gridWorkerBaseUrl: process.env.GRID_WORKER_BASE_URL, stagingWorkerUrl: STAGING_WORKER_URL })));
    } catch (err) {
      console.error(`[grid-summaries] pool fetch failed for ${entry.domain}:`, err instanceof Error ? err.message : err);
    }
  }

  // 2. Needed set: union of every AI-mode pool (already limited by per_site_limit + pins), deduped.
  const needed = new Map<string, { site: string; slug: string; title: string }>();
  for (const pool of pools) for (const i of pool.items) needed.set(`${i.site}:${i.slug}`, i);
  result.needed = needed.size;

  // 3. Decide + generate, grouping planned files per source site. Counting into result.generated /
  // .regenerated / .flagged is deferred to step 4 (post-recheck) since a plan made here can go stale
  // by the time we're ready to commit, possibly minutes later.
  const plannedBySite = new Map<string, PlannedFile[]>();
  const push = (file: PlannedFile): void => {
    plannedBySite.set(file.site, [...(plannedBySite.get(file.site) ?? []), file]);
  };
  let generations = 0;
  for (const { site, slug, title } of needed.values()) {
    try {
      const record = await readArticle(deps, site, slug);
      if (!record) {
        result.failed++;
        continue;
      }
      const hash = sha256(record.body);
      const existing = await readExisting(octokit, config.networkRepo, site, slug);
      const action = decideAction(existing?.fm ?? null, hash);
      if (action === "skip") {
        result.skipped++;
        continue;
      }
      if (action === "flag_source_changed" && existing) {
        push({
          site,
          slug,
          path: summaryPath(site, slug),
          content: serializeSummaryFile({ ...existing.fm, source_changed: true }, existing.markdown),
          action,
          plannedEditedAt: existing.fm.edited_at,
          plannedFrom: snapshotOf(existing),
        });
        continue;
      }
      if (generations >= cap) {
        result.capped = true;
        continue;
      }
      generations++;
      const { markdown, model } = await generateSummary(site, record.frontmatter.title ?? title, record.body);
      push({
        site,
        slug,
        path: summaryPath(site, slug),
        content: serializeSummaryFile(freshFrontmatter(site, slug, hash, model, deps.now()), markdown),
        action,
        plannedEditedAt: existing?.fm.edited_at ?? null,
        plannedFrom: snapshotOf(existing),
      });
    } catch (err) {
      result.failed++;
      console.error(`[grid-summaries] ${site}/${slug} failed:`, err instanceof Error ? err.message : err);
    }
  }

  // 4. Re-check each planned file immediately before its site's commit: a saveEditedSummary or
  // regenerateSummary call may have landed on "main" while this run was generating (which can take
  // minutes). A plan built from a stale read must never overwrite a hand-edited summary it didn't
  // see. One commit per source site.
  for (const [site, planned] of plannedBySite) {
    clearTreeCache("main");
    const survivors: Array<{ path: string; content: string }> = [];
    for (const file of planned) {
      let current: { fm: SummaryFrontmatter; markdown: string } | null;
      try {
        current = await readExisting(octokit, config.networkRepo, file.site, file.slug);
      } catch (err) {
        result.failed++;
        console.error(`[grid-summaries] re-read before commit failed for ${file.site}/${file.slug}, dropping planned ${file.action}:`, err instanceof Error ? err.message : err);
        continue;
      }
      const reason = staleReason(file, current);
      if (reason) {
        result.skipped++;
        console.error(`[grid-summaries] ${file.site}/${file.slug} ${reason} (${file.action}) — dropping to avoid overwriting a newer write`);
        continue;
      }
      survivors.push({ path: file.path, content: file.content });
      if (file.action === "generate") result.generated++;
      else if (file.action === "regenerate") result.regenerated++;
      else result.flagged++;
    }
    if (survivors.length === 0) continue;
    // Accepted window: a write landing between the re-read above and this commit is not detected
    // (commitBatch has no compare-and-swap on file content). It is seconds wide vs the minutes-wide
    // planning window the re-check closes.
    try {
      await commitBatch(octokit, config.networkRepo, survivors, [], `grid summaries: ${site} (${survivors.length} files)`, "main");
      result.commits++;
    } catch (err) {
      result.failed += survivors.length;
      console.error(`[grid-summaries] commit failed for ${site}:`, err instanceof Error ? err.message : err);
    }
  }
  console.log("[grid-summaries] run complete", result);
  return result;
}

let running = false;

/** Fire-and-forget for the hourly cron. Returns false when a run is already in progress. */
export function startGridSummariesRun(config: AgentConfig): boolean {
  if (running) return false;
  running = true;
  void runGridSummaries(config)
    .catch((err: unknown) => console.error("[grid-summaries] run crashed:", err))
    .finally(() => {
      running = false;
    });
  return true;
}

/** Dashboard "Regenerate": always overwrites, including hand-edited summaries (dashboard confirms first). */
export async function regenerateSummary(config: AgentConfig, site: string, slug: string, deps: GridSummariesDeps = defaultDeps()): Promise<{ path: string }> {
  const record = await readArticle(deps, site, slug);
  if (!record) throw new GridSummaryError(`No published article ${site}/${slug}`, 404);
  let generated: { markdown: string; model: string };
  try {
    generated = await generateSummary(site, record.frontmatter.title ?? slug, record.body);
  } catch (err) {
    throw new GridSummaryError(`Generation failed: ${err instanceof Error ? err.message : String(err)}`, 502);
  }
  const path = summaryPath(site, slug);
  const octokit = createOctokit(config.github);
  await commitBatch(octokit, config.networkRepo, [{ path, content: serializeSummaryFile(freshFrontmatter(site, slug, sha256(record.body), generated.model, deps.now()), generated.markdown) }], [], `grid summaries: regenerate ${site}/${slug}`, "main");
  return { path };
}

/** Dashboard "Edit" save: sanitised, marked edited, hash reset to the current source (clears "stale"). */
export async function saveEditedSummary(config: AgentConfig, input: { site: string; slug: string; markdown: string; editedBy: string }, deps: GridSummariesDeps = defaultDeps()): Promise<{ path: string }> {
  const markdown = sanitizeSummaryMarkdown(input.markdown);
  if (!markdown) throw new GridSummaryError("Summary is empty", 400);
  if (markdown.split(/\s+/).length > 1500) throw new GridSummaryError("Summary is too long (max 1500 words)", 400);
  const record = await readArticle(deps, input.site, input.slug);
  if (!record) throw new GridSummaryError(`No published article ${input.site}/${input.slug}`, 404);
  const octokit = createOctokit(config.github);
  const existing = await readExisting(octokit, config.networkRepo, input.site, input.slug);
  const now = deps.now().toISOString();
  const fm: SummaryFrontmatter = {
    source_site: input.site,
    slug: input.slug,
    body_hash: sha256(record.body),
    generated_at: existing?.fm.generated_at ?? now,
    model: existing?.fm.model ?? "human",
    edited: true,
    edited_by: input.editedBy,
    edited_at: now,
    source_changed: false,
  };
  const path = summaryPath(input.site, input.slug);
  await commitBatch(octokit, config.networkRepo, [{ path, content: serializeSummaryFile(fm, markdown) }], [], `grid summaries: edit ${input.site}/${input.slug}`, "main");
  return { path };
}
