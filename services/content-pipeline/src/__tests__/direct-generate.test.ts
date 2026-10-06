import { describe, it, expect, vi } from "vitest";
import { enqueueAndWait, type GenerateJobLike, type GenerateQueueLike } from "../queue/direct-generate.js";
import type { GenerateJobData } from "../queue/types.js";

const DATA: GenerateJobData = {
  siteDomain: "scoopella",
  count: 10,
  branch: "staging/scoopella",
  triggeredBy: "manual",
  bypassSchedule: true,
};

const RESULT = { siteDomain: "scoopella", requested: 10, totalSourced: 30, duplicateCount: 0, availableNew: 10, n8nImagesTriggered: 0, results: [] };

function fakeQueue(job: Partial<GenerateJobLike>, failedReason?: string): GenerateQueueLike & { add: ReturnType<typeof vi.fn> } {
  return {
    add: vi.fn().mockResolvedValue({ id: "7", getState: vi.fn().mockResolvedValue("active"), ...job }),
    getJob: vi.fn().mockResolvedValue(failedReason ? { failedReason } : undefined),
  };
}

describe("enqueueAndWait", () => {
  it("enqueues the job so the worker (which commits articles) runs it", async () => {
    const queue = fakeQueue({ waitUntilFinished: vi.fn().mockResolvedValue(RESULT) });
    await enqueueAndWait(queue, {}, DATA);
    expect(queue.add).toHaveBeenCalledWith("generate", DATA);
  });

  it("returns the worker's result when the job finishes", async () => {
    const queue = fakeQueue({ waitUntilFinished: vi.fn().mockResolvedValue(RESULT) });
    expect(await enqueueAndWait(queue, {}, DATA)).toEqual({ kind: "finished", jobId: "7", result: RESULT });
  });

  it("reports the final failure reason when the job failed", async () => {
    const queue = fakeQueue(
      { waitUntilFinished: vi.fn().mockRejectedValue(new Error("job failed")), getState: vi.fn().mockResolvedValue("failed") },
      "All 3 article(s) failed for scoopella",
    );
    expect(await enqueueAndWait(queue, {}, DATA)).toEqual({ kind: "failed", jobId: "7", error: "All 3 article(s) failed for scoopella" });
  });

  it("returns 'running' when the wait times out but the job is still going", async () => {
    const queue = fakeQueue({ waitUntilFinished: vi.fn().mockRejectedValue(new Error("timed out")) });
    expect(await enqueueAndWait(queue, {}, DATA, 10)).toEqual({ kind: "running", jobId: "7" });
  });
});
