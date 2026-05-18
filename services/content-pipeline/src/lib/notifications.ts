/**
 * Notification helpers for sending alerts when articles need review
 * or when errors occur in the pipeline.
 */

export interface NotificationConfig {
  telegramBotToken?: string;
  telegramChatId?: string;
  slackWebhookUrl?: string;
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

  await Promise.allSettled([
    config.telegramBotToken
      ? sendTelegram(config, message)
      : Promise.resolve(),
    config.slackWebhookUrl ? sendSlack(config, message) : Promise.resolve(),
  ]);
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
  },
): Promise<void> {
  const message = `Pipeline error in ${params.agent}${params.site ? ` (${params.site})` : ""}: ${params.error}`;

  await Promise.allSettled([
    config.telegramBotToken
      ? sendTelegram(config, message)
      : Promise.resolve(),
    config.slackWebhookUrl ? sendSlack(config, message) : Promise.resolve(),
  ]);
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

  await Promise.allSettled([
    config.telegramBotToken ? sendTelegram(config, message) : Promise.resolve(),
    config.slackWebhookUrl ? sendSlack(config, message) : Promise.resolve(),
  ]);
}

/**
 * Send a notification about image generation progress through the ladder.
 * Called at each tier transition so operators can see which providers fail.
 */
export async function notifyImageGeneration(
  config: NotificationConfig,
  params: {
    article: string;
    site?: string;
    provider: string;
    success: boolean;
    reason?: string;
    nextProvider?: string;
  },
): Promise<void> {
  let message: string;

  if (params.success) {
    message =
      `Image generation with ${params.provider} succeeded` +
      ` for "${params.article}"` +
      (params.site ? ` (${params.site})` : "");
  } else {
    message =
      `Image generation with ${params.provider} failed` +
      ` for "${params.article}"` +
      (params.site ? ` (${params.site})` : "") +
      ` because ${params.reason ?? "unknown error"}` +
      (params.nextProvider ? `. Trying now with ${params.nextProvider}...` : "");
  }

  await Promise.allSettled([
    config.telegramBotToken
      ? sendTelegram(config, message)
      : Promise.resolve(),
    config.slackWebhookUrl ? sendSlack(config, message) : Promise.resolve(),
  ]);
}


/**
 * Send a notification when n8n image generation fails and the article
 * falls back to the default site image.
 */
export async function notifyImageDefaultFallback(
  config: NotificationConfig,
  params: {
    site: string;
    articleTitle: string;
    slug: string;
    reason: string;
  },
): Promise<void> {
  const articleUrl = `https://${params.site}/articles/${params.slug}`;
  const message =
    `Image generation failed for site: ${params.site}\n` +
    `Article: "${params.articleTitle}" (${articleUrl})\n` +
    `Reason: ${params.reason}\n` +
    `The article is using the default site image.`;

  await Promise.allSettled([
    config.telegramBotToken
      ? sendTelegram(config, message)
      : Promise.resolve(),
    config.slackWebhookUrl ? sendSlack(config, message) : Promise.resolve(),
  ]);
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
