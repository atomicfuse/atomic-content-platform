import type { IncomingMessage, ServerResponse } from "node:http";
import { Octokit } from "@octokit/rest";
import { runMigration } from "./orchestrator.js";
import type { MigrationConfig } from "./orchestrator.js";
import type { CsvSiteRow, MigrationProgress } from "./types.js";

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
