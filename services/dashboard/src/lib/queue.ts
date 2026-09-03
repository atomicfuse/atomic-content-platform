// services/dashboard/src/lib/queue.ts
import { Queue, QueueEvents, type ConnectionOptions } from "bullmq";
import { Redis } from "ioredis";

const GENERATE_QUEUE = "content-generation";
const MAX_RETRY_DELAY_MS = 30_000;
const KEEP_ALIVE_MS = 30_000;

function getRedisUrl(): string {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL is not set");
  return url;
}

let _connection: Redis | null = null;
function getConnection(): Redis {
  if (!_connection) {
    _connection = new Redis(getRedisUrl(), {
      maxRetriesPerRequest: null,
      enableOfflineQueue: true,
      keepAlive: KEEP_ALIVE_MS,
      retryStrategy(times: number): number {
        const delay = Math.min(times * 1_000, MAX_RETRY_DELAY_MS);
        console.warn(`[redis:dashboard] Reconnect attempt ${times} — retrying in ${delay}ms`);
        return delay;
      },
      reconnectOnError(err: Error): boolean {
        return err.message.includes("READONLY");
      },
    });

    _connection.on("error", (err: Error) => {
      console.error(`[redis:dashboard] Connection error: ${err.message}`);
    });
  }
  return _connection;
}

/**
 * Verify Redis actually answers before enqueueing. With
 * `enableOfflineQueue: true` (needed in prod to ride out blips), commands
 * against an unreachable Redis buffer silently — a job "enqueued" on a dev
 * machine with no Redis is simply lost. Callers should fall back to the
 * direct HTTP proxy when this returns false.
 */
export async function isRedisReachable(timeoutMs = 2_000): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      getConnection().ping(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("redis ping timeout")), timeoutMs);
      }),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

let _queue: Queue | null = null;
export function getGenerateQueue(): Queue {
  if (!_queue) {
    _queue = new Queue(GENERATE_QUEUE, { connection: getConnection() as unknown as ConnectionOptions });
  }
  return _queue;
}

let _events: QueueEvents | null = null;
export function getGenerateQueueEvents(): QueueEvents {
  if (!_events) {
    _events = new QueueEvents(GENERATE_QUEUE, { connection: getConnection() as unknown as ConnectionOptions });
  }
  return _events;
}
