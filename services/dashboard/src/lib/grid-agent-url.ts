// CLAUDE.md "Service Communication — URL Fallback": `http://content-pipeline-app`
// doesn't resolve on the host under `cloudgrid dev`, so every dashboard -> pipeline
// call needs this local-dev fallback.
const CONTENT_AGENT_URL = process.env.CONTENT_AGENT_URL ?? "http://localhost:5000";
const LOCAL_FALLBACK = "http://localhost:5000";
const isLocalDev = process.env.NODE_ENV === "development";

/** content-pipeline base URL with the local-dev DNS fallback. */
export function getAgentUrl(): string {
  if (isLocalDev && CONTENT_AGENT_URL.includes("content-pipeline-app")) {
    return LOCAL_FALLBACK;
  }
  return CONTENT_AGENT_URL;
}
