/**
 * Generate articles for specific slugs that don't exist on WordPress.
 *
 * For each slug, builds a synthetic ContentItem (working title derived from the
 * slug, vertical/topics/audience from the site brief), runs it through the
 * Claude generator, scores it, and commits to staging/<site>.
 *
 * Usage:
 *   pnpm tsx scripts/generate-articles-for-slugs.ts \
 *     --site=journeypeaks \
 *     --slugs=discover-hidden-gems-in-overlooked-british-isles-cities
 *
 * Optional:
 *   --dry-run   Skip the git commit and n8n triggers (still calls Claude).
 */

import "dotenv/config";
import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import { Octokit } from "@octokit/rest";

import matter from "gray-matter";
import { ClaudeGenerator } from "../src/agents/content-generation/generators/claude-generator.js";
import { OpenAIGenerator } from "../src/agents/content-generation/generators/openai-generator.js";
import type { ContentItem } from "../src/agents/content-generation/types.js";
import { ensureTopicTag } from "../src/agents/content-generation/agent.js";
import { estimateReadingTime } from "../src/agents/migration/frontmatter-builder.js";
import { commitBatch } from "../src/lib/github.js";
import type { BatchFileEntry } from "../src/lib/github.js";
import { triggerN8nImage } from "../src/agents/content-generation/n8n-image.js";
import { scoreArticle, resolveStatus } from "../src/agents/content-quality/scorer.js";
import { readSiteBrief } from "../src/lib/site-brief.js";
import type { SiteBrief, QualityScoreBreakdown } from "../src/types.js";

const INTER_REQUEST_DELAY_MS = 1200;

interface CliArgs {
  site: string;
  slugs: string[];
  dryRun: boolean;
  generator: "claude" | "openai";
}

function parseCli(): CliArgs {
  const { values } = parseArgs({
    options: {
      site: { type: "string" },
      slugs: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      generator: { type: "string", default: "claude" },
    },
    allowPositionals: false,
  });

  if (!values.site || !values.slugs) {
    console.error(
      "Usage: tsx scripts/generate-articles-for-slugs.ts --site=<siteId> --slugs=a,b,c [--dry-run] [--generator=claude|openai]",
    );
    process.exit(1);
  }

  const slugs = values.slugs.split(",").map((s) => s.trim()).filter(Boolean);
  if (slugs.length === 0) {
    console.error("No slugs provided");
    process.exit(1);
  }

  const gen = values.generator;
  if (gen !== "claude" && gen !== "openai") {
    console.error(`--generator must be "claude" or "openai" (got "${gen}")`);
    process.exit(1);
  }

  return { site: values.site, slugs, dryRun: values["dry-run"] ?? false, generator: gen };
}

function titleizeSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function buildSyntheticItem(slug: string, brief: SiteBrief): ContentItem {
  const workingTitle = titleizeSlug(slug);
  const topic = brief.topics?.[0] ?? "General";
  const verticalName = brief.vertical ?? "General";

  return {
    id: `synthetic-${slug}`,
    url: "",
    title: workingTitle,
    description: "",
    summary: workingTitle,
    thumbnail: null,
    content_type: "general",
    vertical: { name: verticalName },
    categories: [{ name: topic }],
    tags: [],
    audience_types: brief.audience ? [{ name: brief.audience }] : [],
    source: { name: "Editorial" },
    published_at: new Date().toISOString(),
    language: "en",
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  const args = parseCli();

  const githubToken = process.env.GITHUB_TOKEN;
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  const networkRepo = process.env.NETWORK_REPO ?? "atomicfuse/atomic-labs-network";
  const n8nUrl = process.env.N8N_IMAGE_WEBHOOK_URL;
  const callbackUrl =
    process.env.IMAGE_CALLBACK_URL ??
    "https://sites-platform-e297.atomic.cloudgrid.io/api/agent/image-callback";

  if (!githubToken || !anthropicApiKey) {
    console.error("Missing required env: GITHUB_TOKEN, ANTHROPIC_API_KEY");
    process.exit(1);
  }

  const branch = `staging/${args.site}`;
  const useN8n = !!n8nUrl;
  const defaultImagePath = `/assets/images/${args.site}-general-article.webp`;

  console.log(`[generate] Site:    ${args.site}`);
  console.log(`[generate] Branch:  ${branch}`);
  console.log(`[generate] Slugs:   ${args.slugs.length}`);
  console.log(`[generate] Image:   ${useN8n ? "n8n (async)" : "default only"}`);
  console.log(`[generate] Dry run: ${args.dryRun ? "YES" : "no"}`);
  console.log("");

  const octokit = new Octokit({ auth: githubToken });

  let brief: SiteBrief;
  let siteName: string;
  try {
    const briefData = await readSiteBrief(octokit, networkRepo, args.site, branch);
    brief = briefData.brief;
    siteName = briefData.siteName || args.site;
    console.log(`[generate] Loaded brief for "${siteName}" — vertical=${brief.vertical ?? "n/a"}, topics=${brief.topics?.length ?? 0}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[generate] FATAL: cannot read site brief: ${msg}`);
    process.exit(1);
  }

  const generator = args.generator === "openai" ? new OpenAIGenerator() : new ClaudeGenerator();
  console.log(`[generate] Generator: ${generator.name}`);

  const files: BatchFileEntry[] = [];
  interface PendingImage { slug: string; title: string; description: string }
  const pendingImages: PendingImage[] = [];
  const results: Array<{ slug: string; title?: string; status: "ok" | "error"; error?: string }> = [];

  for (let i = 0; i < args.slugs.length; i++) {
    const targetSlug = args.slugs[i]!;
    const workingTitle = titleizeSlug(targetSlug);
    console.log(`[generate] [${i + 1}/${args.slugs.length}] ${targetSlug}`);
    console.log(`  working title: ${workingTitle}`);

    try {
      if (i > 0) await sleep(INTER_REQUEST_DELAY_MS);

      const item = buildSyntheticItem(targetSlug, brief);
      const generated = await generator.generate(item, { siteName, brief });

      const tags = ensureTopicTag(generated.tags ?? [], brief.topics ?? [], generated.title);
      console.log(`  generated title: ${generated.title}`);

      let quality_score: number | undefined;
      let score_breakdown: QualityScoreBreakdown | undefined;
      let quality_note: string | undefined;
      let articleStatus: "approved" | "review" = "approved";

      try {
        await sleep(INTER_REQUEST_DELAY_MS);
        const q = await scoreArticle(
          { title: generated.title, description: generated.description, body: generated.body, tags, type: "standard" },
          siteName,
          brief,
          brief.quality_weights,
        );
        quality_score = q.overallScore;
        score_breakdown = q.breakdown;
        quality_note = q.note;
        articleStatus = resolveStatus(q.overallScore, brief.quality_threshold);
        console.log(`  quality ${quality_score}/100 → ${articleStatus}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`  quality scoring failed: ${msg}`);
      }

      if (useN8n) {
        pendingImages.push({ slug: targetSlug, title: generated.title, description: generated.description });
      }

      const publishDate = new Date().toISOString().slice(0, 10);
      const cleanBody = generated.body.replace(/^\s*#\s+[^\n]+\n*/, "");
      const readingTime = estimateReadingTime(cleanBody);

      const frontmatter: Record<string, unknown> = {
        title: generated.title,
        description: generated.description,
        type: "standard",
        status: articleStatus,
        publishDate,
        author: "Editorial Team",
        tags,
        slug: targetSlug,
        reviewer_notes: articleStatus === "review" ? (quality_note ?? "") : "",
        source_url: "",
        source_item_id: `synthetic-${targetSlug}`,
        generated_by: generator.name,
        featuredImage: defaultImagePath,
        reading_time: readingTime,
      };
      if (quality_score !== undefined) frontmatter.quality_score = quality_score;
      if (score_breakdown) frontmatter.score_breakdown = score_breakdown;
      if (quality_note) frontmatter.quality_note = quality_note;

      files.push({
        path: `sites/${args.site}/articles/${targetSlug}.md`,
        content: matter.stringify(cleanBody, frontmatter),
      });
      results.push({ slug: targetSlug, title: generated.title, status: "ok" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  error: ${msg}`);
      results.push({ slug: targetSlug, status: "error", error: msg });
    }
  }

  if (files.length === 0) {
    console.error("[generate] No files built. Nothing to commit.");
    process.exit(1);
  }

  if (args.dryRun) {
    console.log(`\n[generate] DRY RUN — would commit ${files.length} file(s) to ${branch}:`);
    for (const f of files) console.log(`  ${f.path}  (${f.content.length} bytes)`);
    console.log("\n--- first file preview ---");
    console.log(files[0]!.content.slice(0, 1200));
    return;
  }

  const commitMsg = `feat(generate): create ${files.length} article(s) for ${args.site}`;
  console.log(`\n[generate] Committing ${files.length} file(s) to ${branch}...`);
  await commitBatch(octokit, networkRepo, files, [], commitMsg, branch);
  console.log(`[generate] Commit done.`);

  if (useN8n && pendingImages.length > 0 && n8nUrl) {
    const verticalName = brief.vertical ?? "general";
    console.log(`[generate] Triggering ${pendingImages.length} n8n image request(s)...`);
    for (const req of pendingImages) {
      void triggerN8nImage(n8nUrl, {
        request_id: `gen_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
        callback_url: callbackUrl,
        job_id: "",
        site_domain: args.site,
        slug: req.slug,
        branch,
        article: {
          title: req.title,
          description: req.description,
          summary: req.description,
          vertical: verticalName,
          source_thumbnail_url: null,
          image_guidelines: null,
        },
      });
    }
    await sleep(500);
  }

  const ok = results.filter((r) => r.status === "ok").length;
  const errs = results.filter((r) => r.status === "error").length;
  console.log("\n[generate] Summary:");
  console.log(`  committed: ${ok}`);
  console.log(`  errors:    ${errs}`);
}

main().catch((err) => {
  console.error("[generate] FATAL:", err);
  process.exit(1);
});
