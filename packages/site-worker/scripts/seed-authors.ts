/**
 * Writes the author library to KV — the ONLY writer of `author:<id>` keys.
 *   author:<id>  ← network repo `authors/<id>.yaml` (public fields only), prod + staging namespaces
 * Deleted authors' keys are pruned — but only when the authors folder exists and at least one file is valid,
 * so a bad checkout can never wipe every profile. Invalid files are reported and fail the run (exit 1)
 * after the valid ones are written.
 * Env (CI): NETWORK_DATA_PATH, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, KV_NAMESPACE_ID_PROD, KV_NAMESPACE_ID_STAGING
 * Env (--local): NETWORK_DATA_PATH, KV_NAMESPACE_ID (default: staging id — matches `pnpm dev:worker`)
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authorEntries, readAuthors, staleAuthorKeys } from './lib/authors-seed';
import { bulkPut } from './lib/kv-bulk';

const STAGING_DEFAULT = 'f6c35e1fa8c841b8b193509a3a237f7f';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`[seed-authors] missing env ${name}`);
  return v;
}

function listAuthorKeys(namespaceId: string, remote: boolean): string[] {
  const out = execFileSync('wrangler', ['kv', 'key', 'list', `--namespace-id=${namespaceId}`, '--prefix=author:', remote ? '--remote' : '--local'], { encoding: 'utf8' });
  return (JSON.parse(out) as Array<{ name: string }>).map((k) => k.name);
}

function deleteKeys(keys: string[], namespaceId: string, remote: boolean): void {
  if (keys.length === 0) return;
  const dir = mkdtempSync(join(tmpdir(), 'seed-authors-'));
  try {
    const file = join(dir, 'delete.json');
    writeFileSync(file, JSON.stringify(keys));
    execFileSync('wrangler', ['kv', 'bulk', 'delete', file, `--namespace-id=${namespaceId}`, '--force', remote ? '--remote' : '--local'], { stdio: 'inherit' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const local = process.argv.includes('--local');
  const { exists, profiles, invalid } = await readAuthors(requireEnv('NETWORK_DATA_PATH'));
  if (!exists) {
    console.log('[seed-authors] no authors/ folder — nothing written, nothing pruned');
    return;
  }
  const targets = local
    ? [process.env.KV_NAMESPACE_ID ?? STAGING_DEFAULT]
    : [requireEnv('KV_NAMESPACE_ID_PROD'), requireEnv('KV_NAMESPACE_ID_STAGING')];
  const entries = authorEntries(profiles);
  for (const ns of targets) {
    bulkPut(entries, ns, !local);
    if (profiles.length > 0) {
      const stale = staleAuthorKeys(listAuthorKeys(ns, !local), profiles, invalid);
      deleteKeys(stale, ns, !local);
      if (stale.length > 0) console.log(`[seed-authors] pruned ${stale.length} deleted author(s) from ${ns.slice(0, 8)}…`);
    }
  }
  console.log(`[seed-authors] authors: ${profiles.length} written, ${invalid.length} invalid; targets: ${targets.length}`);
  if (invalid.length > 0) {
    console.error(`[seed-authors] invalid author files: ${invalid.join(', ')}`);
    process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  console.error('[seed-authors] failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
