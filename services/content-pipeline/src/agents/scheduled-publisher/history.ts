/**
 * Scheduler run history — persists run results to the network repo
 * so the dashboard can display a log of past runs.
 *
 * Storage: scheduler/history.json on main branch.
 * Written after each actual run (not no-op hour-skipped ticks).
 * Capped at 50 entries (rolling window).
 *
 * RunHistoryAccumulator flushes incrementally — after each site
 * completes, the current entry is written so that partial progress
 * survives a CloudGrid timeout (504). Writes are serialized through
 * a promise chain and debounced so concurrent site completions
 * produce at most one GitHub API call per settling period.
 */

import { createOctokit, readFile, commitFile } from "../../lib/github.js";
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
  const octokit = createOctokit(config.github);
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
    const octokit = createOctokit(config.github);
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

/**
 * Incremental history writer. Accumulates site outcomes and flushes to
 * scheduler/history.json after each site completes.
 *
 * - Writes are serialized through a promise chain (no concurrent commits).
 * - Natural debounce: if multiple sites finish before the current flush
 *   completes, the next flush writes all accumulated results at once.
 * - On flush failure, dirty stays true so the next flush retries with
 *   the full accumulated state.
 * - Call `finalize()` at the end to ensure all pending writes land.
 */
export class RunHistoryAccumulator {
  private entry: SchedulerRunEntry;
  private config: AgentConfig;
  private flushChain: Promise<void> = Promise.resolve();
  private dirty = false;

  constructor(timezone: string, forced: boolean, config: AgentConfig) {
    this.config = config;
    this.entry = {
      timestamp: new Date().toISOString(),
      timezone,
      forced,
      sites: [],
      skipped: [],
    };
  }

  /** Record a processed site result (triggered, error, or no_content). */
  recordSiteResult(siteResult: SiteRunResult): void {
    this.entry.sites.push(siteResult);
    this.dirty = true;
    this.scheduleFlush();
  }

  /** Record a skipped site (no schedule, wrong day, no brief, etc.). */
  recordSkipped(domain: string, reason: string): void {
    this.entry.skipped.push({ domain, reason });
    this.dirty = true;
    this.scheduleFlush();
  }

  /** Wait for all pending flushes to complete. */
  async finalize(): Promise<void> {
    this.scheduleFlush();
    await this.flushChain;
  }

  private scheduleFlush(): void {
    this.flushChain = this.flushChain.then(async () => {
      if (!this.dirty) return;
      await this.doFlush();
    });
  }

  private async doFlush(): Promise<void> {
    try {
      const history = await readHistory(this.config);
      // Remove previous version of this entry (same timestamp) if we've flushed before
      const filtered = history.filter((e) => e.timestamp !== this.entry.timestamp);
      // Prepend current accumulated state (snapshot to avoid mutation during async write)
      filtered.unshift({
        ...this.entry,
        sites: [...this.entry.sites],
        skipped: [...this.entry.skipped],
      });
      const trimmed = filtered.slice(0, MAX_ENTRIES);
      const octokit = createOctokit(this.config.github);
      await commitFile(octokit, this.config.networkRepo, {
        path: HISTORY_PATH,
        content: JSON.stringify(trimmed, null, 2),
        message: `scheduler: update run ${this.entry.timestamp}`,
        branch: "main",
      });
      this.dirty = false;
      console.log(
        `[scheduled-publisher] History flushed (${this.entry.sites.length} sites, ${this.entry.skipped.length} skipped)`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[scheduled-publisher] Failed to flush history: ${msg}`);
      // dirty stays true → next flush will retry with full accumulated state
    }
  }
}
