/**
 * Notification helpers for sending alerts when articles need review
 * or when errors occur in the pipeline.
 */

import { DASHBOARD_PUBLIC_URL } from "./config.js";

export interface NotificationConfig {
  telegramBotToken?: string;
  telegramChatId?: string;
  slackWebhookUrl?: string;
}

/**
 * Alert severity. `critical` is for site-down / serving-broken conditions
 * (e.g. a KV sync failure); `not_critical` is for content shortfalls that
 * leave the live site unaffected (no/partial articles, default images,
 * generation job errors). Rendered as a prefix on every Slack/Telegram message.
 */
export type Severity = "critical" | "not_critical";

const SEVERITY_PREFIX: Record<Severity, string> = {
  critical: "🔴 CRITICAL — ",
  not_critical: "🟡 NOT CRITICAL — ",
};

/** Prepend the severity label to a message body. */
function withSeverity(severity: Severity, message: string): string {
  return SEVERITY_PREFIX[severity] + message;
}

/** Dispatch a message to all configured channels (Telegram + Slack). */
async function dispatch(config: NotificationConfig, text: string): Promise<void> {
  await Promise.allSettled([
    config.telegramBotToken ? sendTelegram(config, text) : Promise.resolve(),
    config.slackWebhookUrl ? sendSlack(config, text) : Promise.resolve(),
  ]);
}

/**
 * Send a notification about an article needing review.
 */
export async function notifyReviewNeeded(
  config: NotificationConfig,
  params: {
    site: string;
    title: string;
    dashboardUrl?: string;
  },
): Promise<void> {
  const message = `New article needs review on ${params.site}: "${params.title}"${
    params.dashboardUrl ? `\n${params.dashboardUrl}` : ""
  }`;

  await dispatch(config, withSeverity("not_critical", message));
}

/**
 * Send a notification about a pipeline error.
 */
export async function notifyError(
  config: NotificationConfig,
  params: {
    agent: string;
    error: string;
    site?: string;
    /** Flag a site-down / serving-broken condition as 🔴 CRITICAL. Pipeline
     *  job/generation errors leave the live site up, so they default to
     *  🟡 NOT CRITICAL. */
    critical?: boolean;
  },
): Promise<void> {
  const message = `Pipeline error in ${params.agent}${params.site ? ` (${params.site})` : ""}: ${params.error}`;

  await dispatch(config, withSeverity(params.critical ? "critical" : "not_critical", message));
}

/**
 * Send a summary notification after a scheduler run.
 * Fires when any sites errored or produced zero articles.
 */
export async function notifySummary(
  config: NotificationConfig,
  params: {
    runId: string;
    triggered: number;
    errors: Array<{ domain: string; error: string }>;
    zeroArticleSites: string[];
  },
): Promise<void> {
  if (params.errors.length === 0 && params.zeroArticleSites.length === 0) return;

  const lines: string[] = [`Scheduler run ${params.runId}: ${params.triggered} site(s) triggered`];

  if (params.errors.length > 0) {
    lines.push(`\nErrors (${params.errors.length}):`);
    for (const e of params.errors.slice(0, 5)) {
      lines.push(`  - ${e.domain}: ${e.error}`);
    }
    if (params.errors.length > 5) lines.push(`  ... and ${params.errors.length - 5} more`);
  }

  if (params.zeroArticleSites.length > 0) {
    lines.push(`\nZero articles generated (${params.zeroArticleSites.length}):`);
    for (const d of params.zeroArticleSites.slice(0, 5)) {
      lines.push(`  - ${d}`);
    }
    if (params.zeroArticleSites.length > 5) lines.push(`  ... and ${params.zeroArticleSites.length - 5} more`);
  }

  const message = lines.join("\n");

  await dispatch(config, withSeverity("not_critical", message));
}

export async function notifyImageDefaultFallback(
  config: NotificationConfig,
  params: {
    site: string;
    articleTitle: string;
    slug: string;
    reason: string;
  },
): Promise<void> {
  // A live article URL is NOT derivable from `params.site`: that is the siteId
  // (folder name), not a hostname, and articles are served at /<slug>/ — not
  // /articles/<slug>. The old template produced a dead link in every alert
  // (https://dogslabs/articles/<slug> — no such host, and the path 404s).
  // Link the dashboard instead: always valid, and it is where the image is fixed.
  const reviewUrl = `${DASHBOARD_PUBLIC_URL}/articles/general-images`;
  const message =
    `Image generation failed for site: ${params.site}\n` +
    `Article: "${params.articleTitle}" (${params.slug})\n` +
    `Reason: ${params.reason}\n` +
    `The article is using the default site image — review: ${reviewUrl}`;

  await dispatch(config, withSeverity("not_critical", message));
}

async function sendTelegram(
  config: NotificationConfig,
  text: string,
): Promise<void> {
  if (!config.telegramBotToken || !config.telegramChatId) return;

  await fetch(
    `https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: config.telegramChatId,
        text,
        parse_mode: "HTML",
      }),
    },
  );
}

/**
 * Post a message to Slack VERBATIM — no severity prefix added.
 * Use this for alert templates that already carry their own emoji prefix.
 * Returns `true` on a successful post, `false` if no webhook is configured
 * or the send fails (never throws).
 */
export async function notifyAttention(config: NotificationConfig, message: string): Promise<boolean> {
  if (!config.slackWebhookUrl) return false;
  try {
    await sendSlack(config, message);
    return true;
  } catch (e) {
    console.error(`[alerts] slack send failed: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

async function sendSlack(
  config: NotificationConfig,
  text: string,
): Promise<void> {
  if (!config.slackWebhookUrl) return;

  await fetch(config.slackWebhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
}
