/**
 * Configuration loader for agents.
 */

import type { GitHubConfig } from "./github.js";

export interface AgentConfig {
  github: GitHubConfig;
  networkRepo: string;
  localNetworkPath: string | undefined;
  geminiApiKey: string | undefined;
  contentAggregatorUrl: string;
  port: number;
  redisUrl?: string;
  n8nImageWebhookUrl?: string;
  notifications: {
    telegramBotToken?: string;
    telegramChatId?: string;
    slackWebhookUrl?: string;
  };
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
    contentAggregatorUrl: process.env.CONTENT_AGGREGATOR_URL ?? "https://content-aggregator-v2-34cd.atomic.cloudgrid.io",
    port: process.env.PORT ? (parseInt(process.env.PORT, 10) || 3001) : 3001,
    redisUrl: process.env.REDIS_URL,
    n8nImageWebhookUrl: process.env.N8N_IMAGE_WEBHOOK_URL,
    notifications: {
      telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
      telegramChatId: process.env.TELEGRAM_CHAT_ID,
      slackWebhookUrl: process.env.SLACK_WEBHOOK_URL,
    },
  };
}
