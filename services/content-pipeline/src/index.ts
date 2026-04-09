/**
 * Content Pipeline — HTTP Server Entry Point
 *
 * This is the main entry point for CloudGrid deployment.
 * It starts the HTTP server that handles:
 *   - GET  /health            → health check (required by CloudGrid)
 *   - POST /content-generate  → generate articles for a site
 *   - POST /scheduled-publish → cron-triggered scheduled publishing
 *
 * Also re-exports agents for programmatic use.
 */

// Start the HTTP server (side-effect import)
import "./agents/content-generation/index.js";

// Re-export agents for programmatic use
export { ArticleRegenerationAgent } from "./agents/article-regeneration/index.js";
export { runScheduledPublish } from "./agents/scheduled-publisher/index.js";
export type { ScheduledPublishResult } from "./agents/scheduled-publisher/index.js";
