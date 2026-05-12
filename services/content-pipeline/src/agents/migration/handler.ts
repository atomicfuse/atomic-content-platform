/**
 * HTTP handler for the WordPress migration endpoint.
 *
 * Accepts POST /wp-migrate with a JSON body containing a site row
 * and optional branch. Streams progress via Server-Sent Events (SSE).
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { Octokit } from "@octokit/rest";
import { parseCsvRow } from "./csv-parser.js";
import { runMigration } from "./orchestrator.js";
import type { MigrationConfig } from "./orchestrator.js";
import type { MigrationProgress } from "./types.js";

// ---------------------------------------------------------------------------
// SSE helpers
// ---------------------------------------------------------------------------

function sendSSE(res: ServerResponse, data: unknown): void {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Handle POST /wp-migrate requests.
 *
 * Request body: `{ siteRow: Record<string, string>, branch: string }`
 * Response: SSE stream with progress events, then a final complete/error event.
 */
export async function handleMigrationRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  // ── Read body ──────────────────────────────────────────────────────────

  let body = "";
  req.on("data", (chunk: Buffer) => { body += chunk; });
  await new Promise<void>((resolve) => req.on("end", resolve));

  let payload: { siteRow?: unknown; branch?: unknown };
  try {
    payload = JSON.parse(body) as typeof payload;
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid JSON body" }));
    return;
  }

  // ── Validate ───────────────────────────────────────────────────────────

  const { siteRow, branch } = payload;

  if (!siteRow || typeof siteRow !== "object" || Array.isArray(siteRow)) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "siteRow is required (object)" }));
    return;
  }

  if (!branch || typeof branch !== "string") {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "branch is required (string)" }));
    return;
  }

  const site = parseCsvRow(siteRow as Record<string, string>);

  if (!site.name || !site.postsApiUrl) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "siteRow must include Name and Posts REST API (articles)" }));
    return;
  }

  // ── Env checks ─────────────────────────────────────────────────────────

  const githubToken = process.env.GITHUB_TOKEN;
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  const geminiApiKey = process.env.GEMINI_API_KEY;
  const networkRepo = process.env.NETWORK_REPO ?? "atomicfuse/atomic-labs-network";

  if (!githubToken) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "GITHUB_TOKEN not configured" }));
    return;
  }

  if (!anthropicApiKey) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }));
    return;
  }

  if (!geminiApiKey) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "GEMINI_API_KEY not configured" }));
    return;
  }

  // ── Set up SSE ─────────────────────────────────────────────────────────

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
  });

  // ── Run migration ──────────────────────────────────────────────────────

  const octokit = new Octokit({ auth: githubToken });

  const config: MigrationConfig = {
    anthropicApiKey,
    geminiApiKey,
    octokit,
    networkRepo,
    branch,
  };

  const onProgress = (progress: MigrationProgress): void => {
    sendSSE(res, { type: "progress", progress });
  };

  try {
    console.log(`[wp-migrate] Starting migration for ${site.name} → ${branch}`);
    const report = await runMigration(site, config, onProgress);
    sendSSE(res, { type: "complete", report });
    console.log(`[wp-migrate] Migration complete for ${site.name}: ${report.successful}/${report.totalArticles} articles`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[wp-migrate] Migration failed for ${site.name}:`, message);
    sendSSE(res, { type: "error", error: message });
  }

  res.end();
}
