/**
 * Scheduler run history — persists run results to the network repo
 * so the dashboard can display a log of past runs.
 *
 * Storage: scheduler/history.json on main branch.
 * Written after each actual run (not no-op hour-skipped ticks).
 * Capped at 50 entries (rolling window).
 */

import { createGitHubClient, readFile, commitFile } from "../../lib/github.js";
import type { AgentConfig } from "../../lib/config.js";

const HISTORY_PATH = "scheduler/history.json";
const MAX_ENTRIES = 50;

export interface SiteRunResult {
  domain: string;
  status: "success" | "partial" | "error" | "no_content";
  articlesCreated: number;
  articlesRequested: number;
  message?: string;
}

export interface SchedulerRunEntry {
  timestamp: string;
  timezone: string;
  forced: boolean;
  sites: SiteRunResult[];
  skipped: Array<{ domain: string; reason: string }>;
}

/** Read existing history from network repo main. Returns [] on 404. */
async function readHistory(config: AgentConfig): Promise<SchedulerRunEntry[]> {
  const octokit = createGitHubClient(config.github);
  try {
    const raw = await readFile(octokit, config.networkRepo, HISTORY_PATH);
    return JSON.parse(raw) as SchedulerRunEntry[];
  } catch {
    return [];
  }
}

/**
 * @deprecated Replaced by BullMQ Flow parent processor.
 * Kept temporarily for the direct-execution fallback path.
 * Delete after queue migration is stable (~1 week post-deploy).
 *
 * Append a run entry to scheduler/history.json on main.
 * Reads the current file, prepends the new entry, caps at MAX_ENTRIES,
 * and commits back. Errors are logged but do not throw — history
 * persistence must never break the scheduler itself.
 */
export async function writeRunHistory(
  entry: SchedulerRunEntry,
  config: AgentConfig,
): Promise<void> {
  try {
    const history = await readHistory(config);
    history.unshift(entry);
    const trimmed = history.slice(0, MAX_ENTRIES);
    const octokit = createGitHubClient(config.github);
    await commitFile(octokit, config.networkRepo, {
      path: HISTORY_PATH,
      content: JSON.stringify(trimmed, null, 2),
      message: `scheduler: log run ${entry.timestamp}`,
      branch: "main",
    });
    console.log(`[scheduled-publisher] History written (${trimmed.length} entries)`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[scheduled-publisher] Failed to write run history: ${msg}`);
  }
}
