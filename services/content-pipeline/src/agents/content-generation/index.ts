/**
 * Content Generation Agent — HTTP Server
 *
 * Listens for POST /content-generate requests and runs the content generation agent.
 * The agent autonomously queries the Content Aggregator API using the site's brief
 * to source and rewrite articles.
 *
 * Usage:
 *   pnpm agent:content-generation
 *
 * Then POST to http://localhost:8080/content-generate:
 *   { "siteDomain": "coolnews.dev" }
 *   { "siteDomain": "coolnews.dev", "count": 5 }
 */

import * as http from "node:http";
import dotenv from "dotenv";
dotenv.config({ override: true });
import { loadConfig } from "../../lib/config.js";
import { runContentGeneration } from "./agent.js";
import { runScheduledPublish } from "../scheduled-publisher/index.js";

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
  // Health check — required by CloudGrid
  if (req.method === "GET" && req.url === "/health") {
    sendJson(res, 200, { status: "ok" });
    return;
  }

  // Scheduled publish — called by CloudGrid cron job
  if (req.url === "/scheduled-publish") {
    console.log("[server] Scheduled publish triggered");
    try {
      const result = await runScheduledPublish(config);
      sendJson(res, 200, result as unknown as Record<string, unknown>);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[server] Scheduled publish error:", message);
      sendJson(res, 500, { status: "error", message });
    }
    return;
  }

  if (req.method !== "POST" || req.url !== "/content-generate") {
    sendJson(res, 404, { status: "error", message: "Not found. Use POST /content-generate" });
    return;
  }

  // Read request body
  let body = "";
  req.on("data", (chunk) => { body += chunk; });
  await new Promise<void>((resolve) => req.on("end", resolve));

  let payload: { siteDomain?: unknown; branch?: unknown; count?: unknown };
  try {
    payload = JSON.parse(body) as typeof payload;
  } catch {
    sendJson(res, 400, { status: "error", message: "Invalid JSON body" });
    return;
  }

  // Validate
  const { siteDomain, branch, count } = payload;
  if (!siteDomain || typeof siteDomain !== "string") {
    sendJson(res, 400, { status: "error", message: "siteDomain is required (string)" });
    return;
  }

  const branchStr = typeof branch === "string" ? branch : undefined;
  const countNum = typeof count === "number" && count > 0 ? Math.min(count, 50) : undefined;

  console.log(
    `[server] POST /content-generate — site: ${siteDomain}` +
    `${countNum ? `, count: ${countNum}` : ""}` +
    `${branchStr ? `, branch: ${branchStr}` : ""}`,
  );

  try {
    const result = await runContentGeneration(
      { siteDomain, branch: branchStr, count: countNum },
      config,
    );

    const resultBody = result as unknown as Record<string, unknown>;
    const hasCreated = result.results.some((r) => r.status === "created");
    const allErrors = result.results.every((r) => r.status === "error");

    if (hasCreated) {
      sendJson(res, 201, resultBody);
    } else if (allErrors) {
      sendJson(res, 500, resultBody);
    } else {
      sendJson(res, 200, resultBody);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[server] Agent error:", message);
    sendJson(res, 502, { status: "error", message, results: [{ status: "error", message }] });
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
    sendJson(res, 502, { status: "error", message: "Internal server error", results: [{ status: "error", message: "Internal server error" }] });
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
  console.log(`[server] Aggregator: ${config.contentAggregatorUrl}`);
  console.log(`[server] Write mode: ${config.localNetworkPath ? `local (${config.localNetworkPath})` : "GitHub API"}`);
});
