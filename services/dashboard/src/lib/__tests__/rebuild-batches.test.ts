import { describe, it, expect, vi } from "vitest";
import { syncInBatches } from "../rebuild-batches";

const domains = (n: number): string[] => Array.from({ length: n }, (_, i) => `site${i}`);

describe("syncInBatches", () => {
  it("sends batches of at most batchSize, in order", async () => {
    const send = vi.fn(async (batch: string[]) => ({ ok: batch.length, failed: 0 }));
    await syncInBatches(domains(71), 5, send);
    expect(send).toHaveBeenCalledTimes(15);
    expect(send.mock.calls[0][0]).toEqual(["site0", "site1", "site2", "site3", "site4"]);
    expect(send.mock.calls[14][0]).toEqual(["site70"]);
  });

  it("reports progress after each batch", async () => {
    const progress: number[] = [];
    await syncInBatches(domains(12), 5, async (b) => ({ ok: b.length, failed: 0 }), (done) => progress.push(done));
    expect(progress).toEqual([5, 10, 12]);
  });

  it("sums ok and failed across batches", async () => {
    const result = await syncInBatches(domains(10), 5, async (b) => ({ ok: b.length - 1, failed: 1 }));
    expect(result).toEqual({ ok: 8, failed: 2 });
  });

  it("counts a batch that throws as failed and keeps going", async () => {
    let call = 0;
    const result = await syncInBatches(domains(15), 5, async (b) => {
      call += 1;
      if (call === 2) throw new Error("HTTP 504");
      return { ok: b.length, failed: 0 };
    });
    expect(call).toBe(3);
    expect(result).toEqual({ ok: 10, failed: 5 });
  });

  it("does nothing for an empty list", async () => {
    const send = vi.fn();
    expect(await syncInBatches([], 5, send)).toEqual({ ok: 0, failed: 0 });
    expect(send).not.toHaveBeenCalled();
  });
});
