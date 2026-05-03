// services/dashboard/src/lib/queue.ts
import { Queue, QueueEvents } from "bullmq";
import { Redis } from "ioredis";

const GENERATE_QUEUE = "content-generation";

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
    });
  }
  return _connection;
}

let _queue: Queue | null = null;
export function getGenerateQueue(): Queue {
  if (!_queue) {
    _queue = new Queue(GENERATE_QUEUE, { connection: getConnection() });
  }
  return _queue;
}

let _events: QueueEvents | null = null;
export function getGenerateQueueEvents(): QueueEvents {
  if (!_events) {
    _events = new QueueEvents(GENERATE_QUEUE, { connection: getConnection() });
  }
  return _events;
}
