import { Redis } from "ioredis";

const MAX_RETRY_DELAY_MS = 30_000;
const KEEP_ALIVE_MS = 30_000;

/**
 * Create an IORedis connection for BullMQ.
 *
 * Designed to survive the race condition where the app starts before Redis
 * is ready (common in CloudGrid deploys):
 *
 * - `maxRetriesPerRequest: null` — BullMQ requirement; retries commands
 *   indefinitely instead of throwing after the ioredis default of 20.
 * - `retryStrategy` — reconnection backoff: 1s, 2s, 3s … capped at 30s.
 * - `enableOfflineQueue` — buffers commands while disconnected so callers
 *   don't see errors during transient outages.
 * - `error` handler — prevents unhandled EventEmitter 'error' from killing
 *   the process. Without this, the *first* failed connection attempt crashes
 *   Node before retryStrategy ever fires.
 *
 * Upstash requires TLS (`rediss://` protocol).
 * `keepAlive` prevents Upstash idle disconnects (~300s timeout).
 */
export function createRedisConnection(redisUrl: string): Redis {
  const connection = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableOfflineQueue: true,
    keepAlive: KEEP_ALIVE_MS,
    retryStrategy(times: number): number {
      const delay = Math.min(times * 1_000, MAX_RETRY_DELAY_MS);
      console.log(`[redis] Reconnect attempt ${times} — retrying in ${delay}ms`);
      return delay;
    },
    reconnectOnError(err: Error): boolean {
      // Upstash can return READONLY during failover — force reconnect.
      return err.message.includes("READONLY");
    },
  });

  // CRITICAL: ioredis emits 'error' on every failed connection attempt.
  // Without this handler, Node.js throws an unhandled error and exits.
  connection.on("error", (err: Error) => {
    console.error(`[redis] Connection error: ${err.message}`);
  });

  connection.on("connect", () => {
    console.log("[redis] TCP connection established");
  });

  connection.on("ready", () => {
    console.log("[redis] Ready — accepting commands");
  });

  return connection;
}
