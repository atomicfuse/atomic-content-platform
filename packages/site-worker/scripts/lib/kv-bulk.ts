import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHUNK = 5000; // wrangler bulk put accepts up to 10k per call

/** Writes entries with `wrangler kv bulk put` (same mechanism as seed-kv.ts). */
export function bulkPut(entries: ReadonlyArray<{ key: string; value: string }>, namespaceId: string, remote: boolean): void {
  if (entries.length === 0) return;
  const dir = mkdtempSync(join(tmpdir(), 'seed-grid-'));
  try {
    for (let i = 0; i < entries.length; i += CHUNK) {
      const file = join(dir, `chunk-${i}.json`);
      writeFileSync(file, JSON.stringify(entries.slice(i, i + CHUNK)));
      execFileSync('wrangler', ['kv', 'bulk', 'put', file, `--namespace-id=${namespaceId}`, remote ? '--remote' : '--local'], { stdio: 'inherit' });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
