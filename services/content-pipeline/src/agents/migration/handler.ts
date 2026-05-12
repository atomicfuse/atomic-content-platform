import type { IncomingMessage, ServerResponse } from "node:http";
import { Octokit } from "@octokit/rest";
import { runMigration } from "./orchestrator.js";
import type { MigrationConfig } from "./orchestrator.js";
import type { CsvSiteRow, MigrationProgress } from "./types.js";
import { parseCsvRow } from "./csv-parser.js";
import { buildSiteYaml, domainToSiteId } from "./site-scaffolder.js";
import { commitBatch } from "../../lib/github.js";
import type { BatchFileEntry } from "../../lib/github.js";

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
// POST /wp-migrate/create-sites
// ---------------------------------------------------------------------------

interface CreateSitesRequestBody {
  rows: Record<string, string>[];
  branch: string;
}

interface CreateSiteResult {
  domain: string;
  siteId: string;
  status: "created" | "error";
  error?: string;
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

/**
 * POST /wp-migrate/create-sites
 *
 * Accepts `{ rows: Record<string, string>[], branch: "main" | "staging" }`.
 * Parses each row, generates site.yaml, and batch-commits to the network repo.
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
    sendJson(res, 400, { error: "Invalid JSON body" });
    return;
  }

  if (!Array.isArray(body.rows) || body.rows.length === 0) {
    sendJson(res, 400, { error: "rows is required (non-empty array)" });
    return;
  }

  if (!body.branch) {
    sendJson(res, 400, { error: "branch is required" });
    return;
  }

  const githubToken = process.env.GITHUB_TOKEN;
  const networkRepo = process.env.NETWORK_REPO ?? "atomicfuse/atomic-labs-network";

  if (!githubToken) {
    sendJson(res, 500, { error: "GITHUB_TOKEN not configured" });
    return;
  }

  const octokit = new Octokit({ auth: githubToken });
  const results: CreateSiteResult[] = [];
  const files: BatchFileEntry[] = [];

  for (const row of body.rows) {
    const site = parseCsvRow(row);
    if (!site.name) {
      results.push({ domain: row["Name"] ?? "unknown", siteId: "", status: "error", error: "Missing Name" });
      continue;
    }

    try {
      const siteId = domainToSiteId(site.name);
      const yaml = buildSiteYaml(site);
      files.push({ path: `sites/${siteId}/site.yaml`, content: yaml });
      results.push({ domain: site.name, siteId, status: "created" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({ domain: site.name, siteId: "", status: "error", error: message });
    }
  }

  if (files.length === 0) {
    sendJson(res, 400, { error: "No valid sites to create", results });
    return;
  }

  try {
    const branch = body.branch;
    const commitMsg = `feat(migration): scaffold ${files.length} sites from CSV`;

    console.log(`[create-sites] Committing ${files.length} site.yaml files to ${branch}`);
    await commitBatch(octokit, networkRepo, files, [], commitMsg, branch);

    // If committing to main, also commit to staging branches for each site
    if (branch === "main") {
      for (const file of files) {
        const siteId = file.path.split("/")[1]!;
        const stagingBranch = `staging/${siteId}`;
        try {
          await commitBatch(octokit, networkRepo, [file], [], commitMsg, stagingBranch);
        } catch (err) {
          console.warn(`[create-sites] Failed to commit to ${stagingBranch}:`, err instanceof Error ? err.message : err);
        }
      }
    }

    const created = results.filter((r) => r.status === "created").length;
    console.log(`[create-sites] Done: ${created} sites created on ${branch}`);
    sendJson(res, 201, { status: "ok", created, total: body.rows.length, results });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[create-sites] Commit failed:`, message);
    sendJson(res, 500, { error: message, results });
  }
}
