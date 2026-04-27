import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { readFile, stat, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(__dirname, '..', '..');
const DIST_SERVER = join(PACKAGE_ROOT, 'dist', 'server');
const DIST_CLIENT = join(PACKAGE_ROOT, 'dist', 'client');

let FIXTURE_NETWORK_DIR: string;

/**
 * Spawns `pnpm build` with a fixture NETWORK_DATA_PATH so the production
 * route emit is exercised against a known dashboard-index. The post-build
 * env-config emitter is the regression net for the Astro adapter env-binding
 * gap that surfaced in Phase 6.
 */
beforeAll(async () => {
  FIXTURE_NETWORK_DIR = await mkdtemp(join(tmpdir(), 'atl-env-configs-'));
  // Mirror the real network's coolnews entry plus a second domain so the
  // multi-domain path is exercised.
  const fixture = `
sites:
  - domain: coolnews-atl
    custom_domain: coolnews.dev
  - domain: science-test
    custom_domain: null
  - domain: example-test
    custom_domain: example.test
`.trimStart();
  await writeFile(join(FIXTURE_NETWORK_DIR, 'dashboard-index.yaml'), fixture, 'utf-8');

  // Always rebuild — env-config emit is now a pure function of NETWORK_DATA_PATH
  // contents, and we want our fixture to drive the assertions below.
  execFileSync('pnpm', ['build'], {
    cwd: PACKAGE_ROOT,
    stdio: 'inherit',
    env: { ...process.env, NETWORK_DATA_PATH: FIXTURE_NETWORK_DIR },
  });
});

afterAll(async () => {
  if (FIXTURE_NETWORK_DIR) {
    await rm(FIXTURE_NETWORK_DIR, { recursive: true, force: true });
  }
});

describe('env config emit', () => {
  it('emits dist/server/wrangler.staging.json with correct name + KV + R2 bindings', async () => {
    const raw = await readFile(join(DIST_SERVER, 'wrangler.staging.json'), 'utf-8');
    const cfg = JSON.parse(raw) as Record<string, unknown>;

    expect(cfg.name).toBe('atomic-site-worker-staging');

    const kv = cfg.kv_namespaces as Array<{ binding: string; id?: string }>;
    const configKv = kv.find((b) => b.binding === 'CONFIG_KV');
    expect(configKv?.id).toBe('4673c82cdd7f41d49e93d938fb1c6848');

    const r2 = cfg.r2_buckets as Array<{ binding: string; bucket_name?: string }>;
    const assetBucket = r2.find((b) => b.binding === 'ASSET_BUCKET');
    expect(assetBucket?.bucket_name).toBe('atl-assets-staging');
  });

  it('emits dist/server/wrangler.production.json with correct name + KV + R2 bindings', async () => {
    const raw = await readFile(join(DIST_SERVER, 'wrangler.production.json'), 'utf-8');
    const cfg = JSON.parse(raw) as Record<string, unknown>;

    expect(cfg.name).toBe('atomic-site-worker');

    const kv = cfg.kv_namespaces as Array<{ binding: string; id?: string }>;
    const configKv = kv.find((b) => b.binding === 'CONFIG_KV');
    expect(configKv?.id).toBe('a69cb2c59507482ca5e6d114babdd098');

    const r2 = cfg.r2_buckets as Array<{ binding: string; bucket_name?: string }>;
    const assetBucket = r2.find((b) => b.binding === 'ASSET_BUCKET');
    expect(assetBucket?.bucket_name).toBe('atl-assets-prod');
  });

  it('staging vs production are bound to DIFFERENT KV + R2 resources', async () => {
    // Phase-6 regression: deploy --env production was binding to staging KV.
    // This is the assertion that catches it.
    const staging = JSON.parse(await readFile(join(DIST_SERVER, 'wrangler.staging.json'), 'utf-8')) as Record<string, unknown>;
    const prod = JSON.parse(await readFile(join(DIST_SERVER, 'wrangler.production.json'), 'utf-8')) as Record<string, unknown>;

    const stagingKv = (staging.kv_namespaces as Array<{ binding: string; id?: string }>).find((b) => b.binding === 'CONFIG_KV');
    const prodKv = (prod.kv_namespaces as Array<{ binding: string; id?: string }>).find((b) => b.binding === 'CONFIG_KV');
    expect(stagingKv?.id).toBeDefined();
    expect(prodKv?.id).toBeDefined();
    expect(stagingKv?.id).not.toBe(prodKv?.id);

    const stagingR2 = (staging.r2_buckets as Array<{ binding: string; bucket_name?: string }>).find((b) => b.binding === 'ASSET_BUCKET');
    const prodR2 = (prod.r2_buckets as Array<{ binding: string; bucket_name?: string }>).find((b) => b.binding === 'ASSET_BUCKET');
    expect(stagingR2?.bucket_name).toBeDefined();
    expect(prodR2?.bucket_name).toBeDefined();
    expect(stagingR2?.bucket_name).not.toBe(prodR2?.bucket_name);
  });

  it('production routes are derived from dashboard-index.yaml; staging emits no routes', async () => {
    const staging = JSON.parse(await readFile(join(DIST_SERVER, 'wrangler.staging.json'), 'utf-8')) as Record<string, unknown>;
    const prod = JSON.parse(await readFile(join(DIST_SERVER, 'wrangler.production.json'), 'utf-8')) as Record<string, unknown>;

    expect(staging.routes).toEqual([]);

    const prodRoutes = prod.routes as Array<{ pattern: string; custom_domain?: boolean }>;
    expect(prodRoutes).toBeDefined();

    // Both fixtures with custom_domain set → routes; the null one → skipped.
    const patterns = prodRoutes.map((r) => r.pattern).sort();
    expect(patterns).toEqual(['coolnews.dev', 'example.test']);
    for (const r of prodRoutes) {
      expect(r.custom_domain).toBe(true);
    }
  });

  it('emitted configs are flat — no env metadata leftover', async () => {
    for (const env of ['staging', 'production']) {
      const cfg = JSON.parse(await readFile(join(DIST_SERVER, `wrangler.${env}.json`), 'utf-8')) as Record<string, unknown>;
      // These fields confuse wrangler when present in a flat config; the
      // emit script strips them. Pin the contract.
      expect(cfg.legacy_env, `${env}: legacy_env should be stripped`).toBeUndefined();
      expect(cfg.definedEnvironments, `${env}: definedEnvironments should be stripped`).toBeUndefined();
      expect(cfg.topLevelName, `${env}: topLevelName should be stripped`).toBeUndefined();
    }
  });
});

describe('build artefacts', () => {
  it('Worker entry exists', async () => {
    await expect(stat(join(DIST_SERVER, 'entry.mjs'))).resolves.toBeDefined();
  });

  it('mock-ad-fill.js bundled (legacy ad parity)', async () => {
    const path = join(DIST_CLIENT, 'mock-ad-fill.js');
    const s = await stat(path);
    expect(s.size).toBeGreaterThan(1000); // sanity: not an empty file
  });

  it('placeholder.svg bundled (ArticleCard fallback)', async () => {
    const path = join(DIST_CLIENT, 'placeholder.svg');
    const s = await stat(path);
    expect(s.size).toBeGreaterThan(0);
  });

  it('Astro adapter generated wrangler.json present (used at dev/preview time)', async () => {
    await expect(stat(join(DIST_SERVER, 'wrangler.json'))).resolves.toBeDefined();
  });

  it('does NOT bundle per-site asset directories (assets live in R2)', async () => {
    // Pin the post-R2-migration shape: the previous architecture copied
    // <network>/sites/<id>/assets into dist/client/<id>/assets, which
    // required a redeploy on every new image. R2 removes that need.
    const exists = async (p: string): Promise<boolean> => {
      try { await stat(p); return true; } catch { return false; }
    };
    expect(await exists(join(DIST_CLIENT, 'coolnews-atl', 'assets'))).toBe(false);
    expect(await exists(join(DIST_CLIENT, 'scienceworld', 'assets'))).toBe(false);
  });
});
