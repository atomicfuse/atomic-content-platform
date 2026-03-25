/**
 * Content Generation Agent — HTTP Server
 *
 * Listens for POST /content-generate requests and runs the content generation agent.
 *
 * Usage:
 *   pnpm agent:content-generation
 *
 * Then POST to http://localhost:3001/content-generate:
 *   { "siteDomain": "coolnews.dev", "rssUrl": "https://rss.app/feeds/..." }
 */

import * as http from "node:http";
import "dotenv/config";
import { loadConfig } from "../../lib/config.js";
import { runContentGeneration } from "./agent.js";

function isValidUrl(str: string): boolean {
  try {
    const url = new URL(str);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function sendJson(
  res: http.ServerResponse,
  statusCode: number,
  body: Record<string, unknown>,
): void {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  config: ReturnType<typeof loadConfig>,
): Promise<void> {
  if (req.method !== "POST" || req.url !== "/content-generate") {
    sendJson(res, 404, { status: "error", message: "Not found. Use POST /content-generate" });
    return;
  }

  // Read request body
  let body = "";
  req.on("data", (chunk) => { body += chunk; });
  await new Promise<void>((resolve) => req.on("end", resolve));

  let payload: { siteDomain?: unknown; rssUrl?: unknown };
  try {
    payload = JSON.parse(body) as typeof payload;
  } catch {
    sendJson(res, 400, { status: "error", message: "Invalid JSON body" });
    return;
  }

  // Validate
  const { siteDomain, rssUrl } = payload;
  if (!siteDomain || typeof siteDomain !== "string") {
    sendJson(res, 400, { status: "error", message: "siteDomain is required (string)" });
    return;
  }
  if (!rssUrl || typeof rssUrl !== "string" || !isValidUrl(rssUrl)) {
    sendJson(res, 400, { status: "error", message: "rssUrl is required and must be a valid HTTP/HTTPS URL" });
    return;
  }

  console.log(`[server] POST /content-generate — site: ${siteDomain}, rss: ${rssUrl}`);

  try {
    const result = await runContentGeneration({ siteDomain, rssUrl }, config);

    const resultBody = result as unknown as Record<string, unknown>;
    if (result.status === "created") {
      sendJson(res, 201, resultBody);
    } else if (result.status === "skipped") {
      sendJson(res, 200, resultBody);
    } else {
      sendJson(res, 400, resultBody);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[server] Agent error:", message);
    sendJson(res, 502, { status: "error", message });
  }
}

// Load config at startup — fails fast if env is misconfigured
let config: ReturnType<typeof loadConfig>;
try {
  config = loadConfig();
} catch (err) {
  console.error("[server] Configuration error:", err instanceof Error ? err.message : err);
  process.exit(1);
}

const server = http.createServer((req, res) => {
  handleRequest(req, res, config).catch((err) => {
    console.error("[server] Unhandled error:", err);
    sendJson(res, 502, { status: "error", message: "Internal server error" });
  });
});

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(`[server] Port ${config.port} is already in use`);
  } else {
    console.error("[server] Server error:", err.message);
  }
  process.exit(1);
});

server.listen(config.port, () => {
  console.log(`[server] Content generation agent running on http://localhost:${config.port}`);
  console.log(`[server] POST http://localhost:${config.port}/content-generate`);
  console.log(`[server] Write mode: ${config.localNetworkPath ? `local (${config.localNetworkPath})` : "GitHub API"}`);
});
