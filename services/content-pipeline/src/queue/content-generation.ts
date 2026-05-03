import { Queue, Worker, QueueEvents } from "bullmq";
import type { Redis } from "ioredis";
import type { BatchContentGenerationResult } from "../agents/content-generation/agent.js";
import { GENERATE_QUEUE } from "./types.js";
import type { GenerateJobData } from "./types.js";

export function createGenerateQueue(
  connection: Redis,
): Queue<GenerateJobData, BatchContentGenerationResult> {
  return new Queue(GENERATE_QUEUE, { connection });
}

export function createGenerateQueueEvents(connection: Redis): QueueEvents {
  return new QueueEvents(GENERATE_QUEUE, { connection });
}

export function createGenerateWorker(
  connection: Redis,
  concurrency: number,
): Worker<GenerateJobData, BatchContentGenerationResult> {
  return new Worker<GenerateJobData, BatchContentGenerationResult>(
    GENERATE_QUEUE,
    async (): Promise<BatchContentGenerationResult> => {
      throw new Error("Queue not yet wired — stub processor");
    },
    { connection, concurrency },
  );
}
