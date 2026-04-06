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
