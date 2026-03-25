/**
 * Configuration loader for agents.
 *
 * Reads environment variables and provides typed config objects
 * for GitHub, AI, and notification services.
 */

import type { GitHubConfig } from "./github.js";
import type { AIConfig } from "./ai.js";

export interface AgentConfig {
  github: GitHubConfig;
  ai: AIConfig;
  networkRepo: string;
  notifications: {
    telegramBotToken?: string;
    telegramChatId?: string;
    slackWebhookUrl?: string;
  };
}

/**
 * Load agent configuration from environment variables.
 * Call dotenv.config() before this in your agent entry point.
 */
export function loadConfig(): AgentConfig {
  const githubToken = requireEnv("GITHUB_TOKEN");
  const anthropicKey = requireEnv("ANTHROPIC_API_KEY");
  const networkRepo = requireEnv("NETWORK_REPO");

  return {
    github: {
      token: githubToken,
      repo: networkRepo,
    },
    ai: {
      apiKey: anthropicKey,
    },
    networkRepo,
    notifications: {
      telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
      telegramChatId: process.env.TELEGRAM_CHAT_ID,
      slackWebhookUrl: process.env.SLACK_WEBHOOK_URL,
    },
  };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}
