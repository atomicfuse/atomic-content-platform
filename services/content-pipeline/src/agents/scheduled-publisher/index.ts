/**
 * Scheduled Publisher Agent
 *
 * Called by the CloudGrid cron job via HTTP. Determines which sites
 * are due for new content based on their publishing schedule, then
 * triggers content generation for each due site.
 *
 * Flow:
 * 1. List all sites in the network repo
 * 2. For each site, read brief.schedule
 * 3. Check last published article date
 * 4. If site is due for content, trigger ContentGenerationAgent
 * 5. Respect preferred_days and preferred_time from schedule
 */

import matter from "gray-matter";
import { createGitHubClient, listFiles, readFile } from "../../lib/github.js";
import { listSiteDomains, readSiteBrief } from "../../lib/site-brief.js";
import { runContentGeneration } from "../content-generation/agent.js";
import type { AgentConfig } from "../../lib/config.js";
import type { PublishSchedule } from "@atomic-platform/shared-types";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export interface ScheduledPublishResult {
  status: "ok";
  triggered: string[];
  skipped: Array<{ domain: string; reason: string }>;
  errors: Array<{ domain: string; error: string }>;
}

/**
 * Check if today matches the preferred publishing days.
 * If preferred_days is empty, any day is valid.
 */
function isTodayPreferredDay(schedule: PublishSchedule): boolean {
  if (!schedule.preferred_days || schedule.preferred_days.length === 0) {
    return true;
  }

  const todayName = DAY_NAMES[new Date().getDay()]!;
  return schedule.preferred_days.some(
    (day) => day.toLowerCase() === todayName.toLowerCase(),
  );
}

/**
 * Check if the current time is within a reasonable window of preferred_time.
 * The cron runs every 4 hours, so we accept ±2 hours from preferred time.
 */
function isWithinPreferredTimeWindow(schedule: PublishSchedule): boolean {
  if (!schedule.preferred_time) return true;

  const [hours] = schedule.preferred_time.split(":").map(Number);
  if (hours === undefined || isNaN(hours)) return true;

  const currentHour = new Date().getHours();
  const diff = Math.abs(currentHour - hours);
  return diff <= 2 || diff >= 22; // handle wrap-around (e.g., 23:00 vs 01:00)
}

/**
 * Calculate the minimum number of days between articles based on articles_per_week.
 */
function daysPerArticle(articlesPerWeek: number): number {
  if (articlesPerWeek <= 0) return Infinity;
  return 7 / articlesPerWeek;
}

/**
 * Find the most recent article's publish date for a site.
 * Returns null if no articles exist.
 */
async function getLastPublishDate(
  config: AgentConfig,
  siteDomain: string,
): Promise<Date | null> {
  const octokit = createGitHubClient(config.github);
  const articlesPath = `sites/${siteDomain}/articles`;

  let files: string[];
  try {
    files = await listFiles(octokit, config.networkRepo, articlesPath);
  } catch {
    return null; // No articles directory
  }

  const mdFiles = files.filter((f) => f.endsWith(".md"));
  if (mdFiles.length === 0) return null;

  let latestDate: Date | null = null;

  // Read the last few articles (sorted by name, which is slug-based)
  // to find the most recent publish date without reading all files
  const recentFiles = mdFiles.slice(-5);

  for (const file of recentFiles) {
    try {
      const content = await readFile(
        octokit,
        config.networkRepo,
        `${articlesPath}/${file}`,
      );
      const { data } = matter(content);
      if (data.publishDate) {
        const date = new Date(data.publishDate as string);
        if (!isNaN(date.getTime()) && (!latestDate || date > latestDate)) {
          latestDate = date;
        }
      }
    } catch {
      // Skip unparseable files
    }
  }

  return latestDate;
}

/**
 * Main entry point: check all sites and trigger content generation for due sites.
 */
export async function runScheduledPublish(
  config: AgentConfig,
): Promise<ScheduledPublishResult> {
  const result: ScheduledPublishResult = {
    status: "ok",
    triggered: [],
    skipped: [],
    errors: [],
  };

  // List all sites
  const octokit = createGitHubClient(config.github);
  let domains: string[];
  try {
    domains = await listSiteDomains(octokit, config.networkRepo);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[scheduled-publisher] Failed to list sites:", message);
    return { ...result, errors: [{ domain: "*", error: message }] };
  }

  console.log(`[scheduled-publisher] Checking ${domains.length} site(s)`);

  for (const domain of domains) {
    try {
      // Read site brief
      let brief;
      try {
        const briefData = await readSiteBrief(octokit, config.networkRepo, domain);
        brief = briefData.brief;
      } catch {
        result.skipped.push({ domain, reason: "no brief configured" });
        continue;
      }

      const schedule = brief.schedule;
      if (!schedule || !schedule.articles_per_week || schedule.articles_per_week <= 0) {
        result.skipped.push({ domain, reason: "no publishing schedule" });
        continue;
      }

      // Check preferred day
      if (!isTodayPreferredDay(schedule)) {
        result.skipped.push({ domain, reason: `not a preferred day (${schedule.preferred_days.join(", ")})` });
        continue;
      }

      // Check preferred time window
      if (!isWithinPreferredTimeWindow(schedule)) {
        result.skipped.push({ domain, reason: `outside preferred time window (${schedule.preferred_time})` });
        continue;
      }

      // Check last article date
      const lastDate = await getLastPublishDate(config, domain);
      const interval = daysPerArticle(schedule.articles_per_week);
      const now = new Date();

      if (lastDate) {
        const daysSinceLast = (now.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24);
        if (daysSinceLast < interval) {
          result.skipped.push({
            domain,
            reason: `published ${daysSinceLast.toFixed(1)} days ago (interval: ${interval.toFixed(1)} days)`,
          });
          continue;
        }
      }

      // Site is due — trigger content generation
      console.log(`[scheduled-publisher] Triggering content generation for ${domain}`);
      await runContentGeneration({ siteDomain: domain, count: 1 }, config);
      result.triggered.push(domain);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[scheduled-publisher] Error processing ${domain}:`, message);
      result.errors.push({ domain, error: message });
    }
  }

  console.log(
    `[scheduled-publisher] Done: ${result.triggered.length} triggered, ` +
    `${result.skipped.length} skipped, ${result.errors.length} errors`,
  );

  return result;
}
