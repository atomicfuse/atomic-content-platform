import { Redis } from "ioredis";

/**
 * Create an IORedis connection for BullMQ.
 *
 * Upstash requires TLS (`rediss://` protocol).
 * `maxRetriesPerRequest: null` is required by BullMQ.
 */
export function createRedisConnection(redisUrl: string): Redis {
  return new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    // Upstash closes idle TCP connections after ~300s.
    // BullMQ Workers use long-running BRPOPLPUSH; keepAlive prevents disconnects.
    keepAlive: 30_000,
    retryStrategy: (times: number) => Math.min(times * 1_000, 30_000),
  });
}
