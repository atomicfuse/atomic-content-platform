import { describe, it, expect } from "vitest";
import { processWithConcurrency } from "../lib/concurrency.js";

describe("processWithConcurrency", () => {
  it("processes all items when targetCount equals items.length and isSuccess always true", async () => {
    const items = [1, 2, 3, 4, 5];
    const results = await processWithConcurrency(
      items,
      2,
      items.length,
      async (n) => n * 10,
      () => true,
    );
    expect(results).toHaveLength(5);
    expect(results.sort((a, b) => a - b)).toEqual([10, 20, 30, 40, 50]);
  });

  it("never exceeds maxConcurrency in-flight processors", async () => {
    let peak = 0;
    let current = 0;

    const items = Array.from({ length: 8 }, (_, i) => i);
    await processWithConcurrency(
      items,
      3,
      items.length,
      async (n) => {
        current++;
        peak = Math.max(peak, current);
        // Small delay to let other slots fill
        await new Promise((r) => setTimeout(r, 5));
        current--;
        return n;
      },
      () => true,
    );

    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1); // should actually use multiple slots
  });

  it("stops launching after targetCount successes (serial)", async () => {
    let processed = 0;
    const items = Array.from({ length: 10 }, (_, i) => i);

    const results = await processWithConcurrency(
      items,
      1, // serial — makes counting deterministic
      3,
      async (n) => {
        processed++;
        return n;
      },
      () => true,
    );

    expect(processed).toBe(3);
    expect(results).toHaveLength(3);
  });

  it("returns empty array for empty input", async () => {
    const results = await processWithConcurrency<number, number>(
      [],
      3,
      5,
      async (n) => n,
      () => true,
    );
    expect(results).toEqual([]);
  });

  it("non-success items do not count toward targetCount", async () => {
    // Even values succeed, odd values fail
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const results = await processWithConcurrency(
      items,
      1, // serial for determinism
      3, // want 3 successes
      async (n) => ({ value: n, ok: n % 2 === 0 }),
      (r) => r.ok,
    );

    const successes = results.filter((r) => r.ok);
    expect(successes).toHaveLength(3);
    // Successes should be 2, 4, 6
    expect(successes.map((r) => r.value)).toEqual([2, 4, 6]);
  });
});
