/**
 * Splits a staging KV sync across several small requests.
 *
 * Each site sync is a GitHub push of a few seconds; one request for 70+ sites
 * outlives CloudGrid's ~60 s gateway limit, and the browser reports a failure
 * while the server carries on. Small sequential batches keep every request short.
 */

/** Result of one batch request, or of the whole run. */
export interface BatchTotals {
  ok: number;
  failed: number;
}

/**
 * Sends `domains` in sequential batches of `batchSize`. A batch that throws is
 * counted as failed and the run continues with the next one.
 */
export async function syncInBatches(
  domains: string[],
  batchSize: number,
  send: (batch: string[]) => Promise<BatchTotals>,
  onProgress?: (done: number, total: number) => void,
): Promise<BatchTotals> {
  const totals: BatchTotals = { ok: 0, failed: 0 };
  for (let i = 0; i < domains.length; i += batchSize) {
    const batch = domains.slice(i, i + batchSize);
    try {
      const result = await send(batch);
      totals.ok += result.ok;
      totals.failed += result.failed;
    } catch (err) {
      console.error("[rebuild] batch failed", batch, err);
      totals.failed += batch.length;
    }
    onProgress?.(Math.min(i + batchSize, domains.length), domains.length);
  }
  return totals;
}
