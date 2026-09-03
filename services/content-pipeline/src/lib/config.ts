/**
 * Configuration loader for agents.
 */

import type { GitHubConfig } from "./github.js";

/**
 * Public dashboard origin, used to build links in outbound notifications.
 * Single definition: alerts/run.ts and lib/notifications.ts both read it, and
 * a wrong value here means dead links in Slack.
 *
 * NOT the same as the in-cluster `http://dashboard-app` used for service calls.
 */
export const DASHBOARD_PUBLIC_URL =
  process.env.DASHBOARD_URL ?? "https://sites-platform-e297--atomic.cloudgrid.io";

export interface AgentConfig {
  github: GitHubConfig;
  networkRepo: string;
  localNetworkPath: string | undefined;
  geminiApiKey: string | undefined;
  anthropicApiKey?: string;
  contentAggregatorUrl: string;
  port: number;
  redisUrl?: string;
  n8nImageWebhookUrl?: string;
  imageCallbackUrl?: string;
  bulkImageApiKey?: string;
  notifications: {
    telegramBotToken?: string;
    telegramChatId?: string;
    slackWebhookUrl?: string;
  };
}

function parsePort(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function loadConfig(): AgentConfig {
  const localNetworkPath = process.env.LOCAL_NETWORK_PATH;
  const githubToken = process.env.GITHUB_TOKEN;
  const networkRepo = process.env.NETWORK_REPO;

  // Validate at least one write mode is configured
  if (!localNetworkPath && (!githubToken || !networkRepo)) {
    throw new Error(
      "Either LOCAL_NETWORK_PATH or both GITHUB_TOKEN + NETWORK_REPO must be set",
    );
  }

  return {
    github: {
      token: githubToken ?? "",
      repo: networkRepo ?? "",
    },
    networkRepo: networkRepo ?? "",
    localNetworkPath,
    geminiApiKey: process.env.GEMINI_API_KEY,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    contentAggregatorUrl: process.env.CONTENT_AGGREGATOR_URL ?? "https://content-aggregator-v2-34cd--atomic.cloudgrid.io",
    // CONTENT_PIPELINE_PORT is a local-dev override: `cloudgrid dev` injects
    // PORT=3000 into every service, which collides with the dashboard and
    // pushes this service onto the 5111 fallback while the dashboard proxy
    // expects :5000. In production only PORT exists, so PORT still wins there.
    port: parsePort(process.env.CONTENT_PIPELINE_PORT) ?? parsePort(process.env.PORT) ?? 3001,
    redisUrl: process.env.REDIS_URL,
    n8nImageWebhookUrl: process.env.N8N_IMAGE_WEBHOOK_URL,
    imageCallbackUrl: process.env.IMAGE_CALLBACK_URL,
    bulkImageApiKey: process.env.BULK_IMAGE_API_KEY,
    notifications: {
      telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
      telegramChatId: process.env.TELEGRAM_CHAT_ID,
      slackWebhookUrl: process.env.SLACK_WEBHOOK_URL,
    },
  };
}
