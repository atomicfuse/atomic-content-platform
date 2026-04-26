import { describe, expect, it, beforeAll } from 'vitest';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(__dirname, '..', '..');
const DIST_SERVER = join(PACKAGE_ROOT, 'dist', 'server');
const DIST_CLIENT = join(PACKAGE_ROOT, 'dist', 'client');

/**
 * Spawns `pnpm build` if `dist/` is missing or out-of-date, then asserts on
 * its outputs. The post-build env-config emitter is the regression net for
 * the Astro adapter env-binding gap that surfaced in Phase 6 — a config
 * shape change in either the adapter or our emitter trips this test before
 * a deploy ever happens.
 */
beforeAll(async () => {
  const stagingPath = join(DIST_SERVER, 'wrangler.staging.json');
  const needsBuild = !existsSync(stagingPath);
  if (needsBuild) {
    // Run via pnpm (not npm) so the workspace-root config is honoured.
    // stdio: 'inherit' surfaces build failures directly.
    execFileSync('pnpm', ['build'], { cwd: PACKAGE_ROOT, stdio: 'inherit' });
  } else {
    // Touch-check: if dist is older than seed-kv.ts or astro.config.mjs,
    // re-build. Cheap insurance against stale artefacts.
    const distStat = await stat(stagingPath);
    const sentinels = ['scripts/seed-kv.ts', 'astro.config.mjs', 'package.json'];
    const shouldRebuild = await Promise.all(
      sentinels.map((p) => stat(join(PACKAGE_ROOT, p)).then((s) => s.mtimeMs > distStat.mtimeMs)),
    );
    if (shouldRebuild.some(Boolean)) {
      execFileSync('pnpm', ['build'], { cwd: PACKAGE_ROOT, stdio: 'inherit' });
    }
  }
});

describe('env config emit', () => {
  it('emits dist/server/wrangler.staging.json with correct name + KV id', async () => {
    const raw = await readFile(join(DIST_SERVER, 'wrangler.staging.json'), 'utf-8');
    const cfg = JSON.parse(raw) as Record<string, unknown>;

    expect(cfg.name).toBe('atomic-site-worker-staging');

    const kv = cfg.kv_namespaces as Array<{ binding: string; id?: string }>;
    const configKv = kv.find((b) => b.binding === 'CONFIG_KV');
    expect(configKv?.id).toBe('4673c82cdd7f41d49e93d938fb1c6848');
  });

  it('emits dist/server/wrangler.production.json with correct name + KV id', async () => {
    const raw = await readFile(join(DIST_SERVER, 'wrangler.production.json'), 'utf-8');
    const cfg = JSON.parse(raw) as Record<string, unknown>;

    expect(cfg.name).toBe('atomic-site-worker');

    const kv = cfg.kv_namespaces as Array<{ binding: string; id?: string }>;
    const configKv = kv.find((b) => b.binding === 'CONFIG_KV');
    expect(configKv?.id).toBe('a69cb2c59507482ca5e6d114babdd098');
  });

  it('staging vs production are bound to DIFFERENT namespaces', async () => {
    // Phase-6 regression: deploy --env production was binding to staging KV.
    // This is the assertion that catches it.
    const staging = JSON.parse(await readFile(join(DIST_SERVER, 'wrangler.staging.json'), 'utf-8')) as Record<string, unknown>;
    const prod = JSON.parse(await readFile(join(DIST_SERVER, 'wrangler.production.json'), 'utf-8')) as Record<string, unknown>;

    const stagingKv = (staging.kv_namespaces as Array<{ binding: string; id?: string }>).find((b) => b.binding === 'CONFIG_KV');
    const prodKv = (prod.kv_namespaces as Array<{ binding: string; id?: string }>).find((b) => b.binding === 'CONFIG_KV');

    expect(stagingKv?.id).toBeDefined();
    expect(prodKv?.id).toBeDefined();
    expect(stagingKv?.id).not.toBe(prodKv?.id);
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
});
