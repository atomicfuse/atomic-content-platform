/**
 * Scheduler config + trigger helpers.
 *
 * Scheduler config lives in the network repo at `scheduler/config.yaml` so
 * schedule changes don't require a platform redeploy. The content-pipeline
 * service reads the same file on every CloudGrid cron tick.
 */

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { readFileContent, commitNetworkFiles } from "@/lib/github";

export const SCHEDULER_CONFIG_PATH = "scheduler/config.yaml";

export interface SchedulerConfig {
  enabled: boolean;
  run_at_hours: number[];
  timezone: string;
}

export const DEFAULT_SCHEDULER_CONFIG: SchedulerConfig = {
  enabled: true,
  run_at_hours: [14],
  timezone: "EST",
};

/** Read scheduler/config.yaml from main. Returns defaults if missing. */
export async function readSchedulerConfig(): Promise<SchedulerConfig> {
  const raw = await readFileContent(SCHEDULER_CONFIG_PATH, "main");
  if (raw === null) return { ...DEFAULT_SCHEDULER_CONFIG };
  const parsed = (parseYaml(raw) as Partial<SchedulerConfig> | null) ?? {};
  return {
    enabled: parsed.enabled ?? DEFAULT_SCHEDULER_CONFIG.enabled,
    run_at_hours:
      Array.isArray(parsed.run_at_hours) && parsed.run_at_hours.length > 0
        ? parsed.run_at_hours.filter(
            (h): h is number => typeof h === "number" && Number.isInteger(h) && h >= 0 && h <= 23,
          )
        : DEFAULT_SCHEDULER_CONFIG.run_at_hours,
    timezone: parsed.timezone ?? DEFAULT_SCHEDULER_CONFIG.timezone,
  };
}

/** Write scheduler/config.yaml to main (creates file if absent). */
export async function writeSchedulerConfig(cfg: SchedulerConfig): Promise<void> {
  const content = stringifyYaml(cfg, { lineWidth: 0 });
  await commitNetworkFiles(
    [{ path: SCHEDULER_CONFIG_PATH, content }],
    "scheduler: update config",
    "main",
  );
}

/**
 * Trigger an immediate scheduler run via the content-pipeline's
 * /scheduled-publish?force=true endpoint.
 *
 * Mirrors the env + local-dev fallback pattern used by
 * `src/app/api/agent/generate/route.ts` so behaviour matches across
 * CloudGrid and local `pnpm dev` / `cloudgrid dev`.
 */
const CONTENT_AGENT_URL =
  process.env.CONTENT_AGENT_URL ?? "http://localhost:5000";
const LOCAL_FALLBACK = "http://localhost:5000";
const isLocalDev = process.env.NODE_ENV === "development";

function getAgentUrl(): string {
  // In local dev, cloudgrid.yaml may inject an internal DNS name
  // (e.g. http://content-pipeline-app) that doesn't resolve on the host.
  if (isLocalDev && CONTENT_AGENT_URL.includes("content-pipeline-app")) {
    return LOCAL_FALLBACK;
  }
  return CONTENT_AGENT_URL;
}

export async function triggerSchedulerRun(): Promise<unknown> {
  const base = getAgentUrl().replace(/\/$/, "");
  const url = `${base}/scheduled-publish?force=true`;
  try {
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) {
      throw new Error(`Scheduler HTTP ${res.status}: ${await res.text()}`);
    }
    return await res.json();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to reach content agent";
    throw new Error(
      `Content agent unavailable at ${base}: ${message}. ` +
        `Is the agent running? (pnpm agent:content-generation)`,
    );
  }
}
