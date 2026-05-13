import type { IncomingMessage, ServerResponse } from "node:http";
import { Octokit } from "@octokit/rest";
import { parse, stringify } from "yaml";
import { runMigration } from "./orchestrator.js";
import type { MigrationConfig } from "./orchestrator.js";
import type { CsvSiteRow, MigrationProgress } from "./types.js";
import { parseCsvRow } from "./csv-parser.js";
import { resolveCategories } from "./category-resolver.js";
import { buildFullSiteConfig, buildSkillMd, generateAuthorName, domainToSiteId } from "./site-scaffolder.js";
import { commitBatch, readFile, parseRepo } from "../../lib/github.js";
import type { BatchFileEntry, BatchBinaryEntry } from "../../lib/github.js";

function sendSSE(res: ServerResponse, data: unknown): void {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

interface MigrationRequestBody {
  siteDomain: string;
  wpApiUrl: string;
  branch?: string;
  menuItems?: string[];
  websiteCategory?: string;
}

/**
 * POST /wp-migrate
 *
 * Accepts `{ siteDomain, wpApiUrl, branch?, menuItems?, websiteCategory? }`.
 * Streams SSE progress events back to the caller.
 */
export async function handleMigrationRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  let rawBody = "";
  req.on("data", (chunk: Buffer) => { rawBody += chunk; });
  await new Promise<void>((resolve) => req.on("end", resolve));

  let body: MigrationRequestBody;
  try {
    body = JSON.parse(rawBody) as MigrationRequestBody;
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid JSON body" }));
    return;
  }

  if (!body.siteDomain || !body.wpApiUrl) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "siteDomain and wpApiUrl are required" }));
    return;
  }

  const githubToken = process.env.GITHUB_TOKEN;
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  const geminiApiKey = process.env.GEMINI_API_KEY;
  const networkRepo = process.env.NETWORK_REPO ?? "atomicfuse/atomic-labs-network";

  if (!githubToken || !anthropicApiKey || !geminiApiKey) {
    const missing = [
      !githubToken && "GITHUB_TOKEN",
      !anthropicApiKey && "ANTHROPIC_API_KEY",
      !geminiApiKey && "GEMINI_API_KEY",
    ].filter(Boolean).join(", ");
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: `Missing env vars: ${missing}` }));
    return;
  }

  const branch = body.branch ?? `staging/${body.siteDomain}`;
  const alsoCommitTo = branch === "main" ? `staging/${body.siteDomain}` : undefined;

  const site: CsvSiteRow = {
    name: body.siteDomain,
    domain: body.siteDomain,
    company: "",
    websiteCategory: body.websiteCategory ?? "General",
    menuItems: body.menuItems ?? [],
    iabCategories: [],
    subCategories: [],
    colorPalette: {},
    logoUrl: "",
    faviconUrl: "",
    postsApiUrl: body.wpApiUrl,
    gaInfo: {},
  };

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const octokit = new Octokit({ auth: githubToken });

  const config: MigrationConfig = {
    anthropicApiKey,
    geminiApiKey,
    octokit,
    networkRepo,
    branch,
    alsoCommitTo,
  };

  const onProgress = (progress: MigrationProgress): void => {
    sendSSE(res, { type: "progress", ...progress });
  };

  try {
    console.log(`[wp-migrate] Starting migration for ${site.name} → ${branch}`);
    const report = await runMigration(site, config, onProgress);
    sendSSE(res, { type: "complete", ...report });
    console.log(`[wp-migrate] Done: ${report.successful}/${report.totalArticles} articles`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[wp-migrate] Failed for ${site.name}:`, message);
    sendSSE(res, { type: "error", error: message });
  }

  res.end();
}

// ---------------------------------------------------------------------------
// POST /wp-migrate/create-sites  (wizard-equivalent SSE endpoint)
// ---------------------------------------------------------------------------

interface CreateSitesRequestBody {
  rows: Record<string, string>[];
  branch: string;
}

interface CreateSiteResult {
  domain: string;
  siteId: string;
  status: "created" | "error";
  previewUrl?: string;
  warnings?: string[];
  postsApiUrl?: string;
  error?: string;
}

async function fetchImageAsBase64(url: string): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.startsWith("image")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.toString("base64");
  } catch {
    return null;
  }
}

/**
 * POST /wp-migrate/create-sites
 *
 * Full wizard-equivalent SSE endpoint. Creates complete sites:
 * branch, full site.yaml, skill.md, logo/favicon, bundle, dashboard-index, KV sync.
 */
export async function handleCreateSites(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  let rawBody = "";
  req.on("data", (chunk: Buffer) => { rawBody += chunk; });
  await new Promise<void>((resolve) => req.on("end", resolve));

  let body: CreateSitesRequestBody;
  try {
    body = JSON.parse(rawBody) as CreateSitesRequestBody;
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid JSON body" }));
    return;
  }

  if (!Array.isArray(body.rows) || body.rows.length === 0) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "rows is required (non-empty array)" }));
    return;
  }

  if (!body.branch) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "branch is required" }));
    return;
  }

  const githubToken = process.env.GITHUB_TOKEN;
  const networkRepo = process.env.NETWORK_REPO ?? "atomicfuse/atomic-labs-network";

  if (!githubToken) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "GITHUB_TOKEN not configured" }));
    return;
  }

  // SSE setup
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const octokit = new Octokit({ auth: githubToken });
  const { owner, repo: repoName } = parseRepo(networkRepo);
  const results: CreateSiteResult[] = [];

  for (const row of body.rows) {
    const site = parseCsvRow(row);
    const domainOrName = site.domain || site.name;
    const siteId = domainToSiteId(domainOrName);
    const previewUrl = `https://atomic-site-worker-staging.dev1-953.workers.dev/?_atl_site=${siteId}`;
    const warnings: string[] = [];

    if (!domainOrName) {
      results.push({ domain: row["Name"] ?? "unknown", siteId: "", status: "error", error: "Missing Name/domain" });
      sendSSE(res, { type: "site-complete", domain: row["Name"] ?? "unknown", siteId: "", status: "error", error: "Missing Name/domain" });
      continue;
    }

    try {
      // 1. Resolve categories
      sendSSE(res, { type: "site-progress", domain: domainOrName, siteId, phase: "resolving-categories" });
      let resolved: Awaited<ReturnType<typeof resolveCategories>> = null;
      try {
        resolved = await resolveCategories(site.websiteCategory, site.subCategories, site.name);
      } catch (err) {
        warnings.push(`Category resolution failed: ${err instanceof Error ? err.message : String(err)}`);
      }

      // 2. Fetch assets
      sendSSE(res, { type: "site-progress", domain: domainOrName, siteId, phase: "fetching-assets" });
      const logoBase64 = await fetchImageAsBase64(site.logoUrl);
      if (site.logoUrl && !logoBase64) warnings.push("Could not fetch logo");
      const faviconBase64 = await fetchImageAsBase64(site.faviconUrl);
      if (site.faviconUrl && !faviconBase64) warnings.push("Could not fetch favicon");

      // 3. Build config
      sendSSE(res, { type: "site-progress", domain: domainOrName, siteId, phase: "building-config" });
      const author = generateAuthorName();
      const config = buildFullSiteConfig(site, resolved, author, !!logoBase64, !!faviconBase64);
      const skillContent = buildSkillMd(site.name || siteId, config.brief.topics, site.websiteCategory || "General");

      // 4. Create staging branch
      sendSSE(res, { type: "site-progress", domain: domainOrName, siteId, phase: "creating-branch" });
      try {
        const { data: mainRef } = await octokit.git.getRef({ owner, repo: repoName, ref: "heads/main" });
        await octokit.git.createRef({
          owner, repo: repoName,
          ref: `refs/heads/staging/${siteId}`,
          sha: mainRef.object.sha,
        });
      } catch (e: unknown) {
        if ((e as { status?: number }).status !== 422) throw e;
        // 422 = branch already exists, non-fatal
      }

      // 5. Commit files
      sendSSE(res, { type: "site-progress", domain: domainOrName, siteId, phase: "committing" });
      const textFiles: BatchFileEntry[] = [
        { path: `sites/${siteId}/site.yaml`, content: stringify(config, { lineWidth: 0 }) },
        { path: `sites/${siteId}/skill.md`, content: skillContent },
        { path: `sites/${siteId}/assets/.gitkeep`, content: "" },
        { path: `sites/${siteId}/articles/.gitkeep`, content: "" },
      ];
      const binaryFiles: BatchBinaryEntry[] = [];
      if (logoBase64) binaryFiles.push({ path: `sites/${siteId}/assets/logo.png`, base64: logoBase64 });
      if (faviconBase64) binaryFiles.push({ path: `sites/${siteId}/assets/favicon.png`, base64: faviconBase64 });

      await commitBatch(
        octokit, networkRepo, textFiles, binaryFiles,
        `feat: scaffold site ${siteId} from CSV import`,
        `staging/${siteId}`,
      );

      // 6. Update dashboard-index.yaml on main
      sendSSE(res, { type: "site-progress", domain: domainOrName, siteId, phase: "updating-index" });
      try {
        const indexContent = await readFile(octokit, networkRepo, "dashboard-index.yaml", "main");
        const index = parse(indexContent) as { sites: Array<Record<string, unknown>> };
        const existing = index.sites.find((s: Record<string, unknown>) => s.domain === siteId);
        if (!existing) {
          const now = new Date().toISOString();
          index.sites.push({
            domain: siteId,
            company: site.company || null,
            vertical: site.websiteCategory || null,
            status: "Staging",
            site_id: `${Date.now().toString().slice(-10)}${Math.floor(Math.random() * 1000).toString().padStart(3, "0")}`,
            exclusivity: null,
            ob_epid: null,
            ga_info: null,
            cf_apo: false,
            fixed_ad: false,
            last_updated: now,
            created_at: now,
            pages_project: null,
            pages_subdomain: null,
            zone_id: null,
            staging_branch: `staging/${siteId}`,
            preview_url: previewUrl,
            saved_previews: null,
            custom_domain: null,
          });
          await commitBatch(
            octokit, networkRepo,
            [{ path: "dashboard-index.yaml", content: stringify(index, { lineWidth: 0 }) }],
            [],
            `dashboard: add ${siteId}`,
            "main",
          );
        }
      } catch (err) {
        warnings.push(`Failed to update dashboard-index: ${err instanceof Error ? err.message : String(err)}`);
      }

      // 7. Trigger KV sync
      sendSSE(res, { type: "site-progress", domain: domainOrName, siteId, phase: "triggering-sync" });
      try {
        const triggerPath = `sites/${siteId}/.build-trigger`;
        let existingSha: string | undefined;
        try {
          const { data } = await octokit.repos.getContent({
            owner, repo: repoName,
            path: triggerPath,
            ref: `staging/${siteId}`,
          });
          if ("sha" in data) existingSha = data.sha as string;
        } catch {
          /* doesn't exist yet */
        }
        await octokit.repos.createOrUpdateFileContents({
          owner, repo: repoName,
          path: triggerPath,
          message: `ci: trigger KV sync for ${siteId}`,
          content: Buffer.from(new Date().toISOString()).toString("base64"),
          sha: existingSha,
          branch: `staging/${siteId}`,
        });
      } catch (err) {
        warnings.push(`KV sync trigger failed: ${err instanceof Error ? err.message : String(err)}`);
      }

      // 8. Done
      const result: CreateSiteResult = {
        domain: domainOrName,
        siteId,
        status: "created",
        previewUrl,
        warnings: warnings.length > 0 ? warnings : undefined,
        postsApiUrl: site.postsApiUrl || undefined,
      };
      results.push(result);
      sendSSE(res, { type: "site-complete", ...result });
      console.log(`[create-sites] Created ${siteId} (${warnings.length} warnings)`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const result: CreateSiteResult = { domain: domainOrName, siteId, status: "error", error: message };
      results.push(result);
      sendSSE(res, { type: "site-complete", domain: domainOrName, siteId, status: "error", error: message });
      console.error(`[create-sites] Error for ${siteId}:`, message);
    }
  }

  sendSSE(res, { type: "all-complete", results });
  res.end();
}
