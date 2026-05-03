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
  });
}
