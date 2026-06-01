/**
 * Generic concurrency-limited processor.
 *
 * Runs `processor` over `items` with at most `maxConcurrency` in flight.
 * Stops launching new items once `targetCount` successes (per `isSuccess`)
 * have been reached, but always waits for in-flight work to finish.
 *
 * To process ALL items (no early stop), pass `items.length` as `targetCount`
 * and `() => true` as `isSuccess`.
 */
export async function processWithConcurrency<T, R>(
  items: T[],
  maxConcurrency: number,
  targetCount: number,
  processor: (item: T) => Promise<R>,
  isSuccess: (result: R) => boolean,
): Promise<R[]> {
  const results: R[] = [];
  let successCount = 0;
  let nextIndex = 0;
  const inFlight = new Set<Promise<void>>();

  /** Whether we need AND can launch more items. */
  function shouldLaunch(): boolean {
    // Don't launch if we already have enough successes + pending to hit target
    if (successCount + inFlight.size >= targetCount) return false;
    // Don't launch if we ran out of items
    if (nextIndex >= items.length) return false;
    return true;
  }

  async function processNext(): Promise<void> {
    const idx = nextIndex++;
    const item = items[idx]!;

    const result = await processor(item);
    results.push(result);

    if (isSuccess(result)) {
      successCount++;
    }
  }

  while ((successCount < targetCount && nextIndex < items.length) || inFlight.size > 0) {
    // Fill up to maxConcurrency, but only if we still need more
    while (shouldLaunch() && inFlight.size < maxConcurrency) {
      const p = processNext().then(() => {
        inFlight.delete(p);
      });
      inFlight.add(p);
    }

    // Wait for at least one to complete
    if (inFlight.size > 0) {
      await Promise.race(inFlight);
    }
  }

  return results;
}
