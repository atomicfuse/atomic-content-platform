#!/usr/bin/env tsx
/**
 * Post-build helper. Reads the adapter-generated `dist/server/wrangler.json`
 * (which is flat — top-level config only) and emits per-environment
 * variants with the right Worker name + KV bindings:
 *
 *   dist/server/wrangler.staging.json
 *   dist/server/wrangler.production.json
 *
 * Why: the Astro Cloudflare adapter v13 doesn't propagate
 * `[[env.<name>.kv_namespaces]]` from the user `wrangler.toml` into the
 * generated config. So `wrangler deploy --env production` ends up bound
 * to whatever's at the top level (staging KV) and just suffixes the name.
 * Until the adapter handles envs natively, this script is the bridge.
 *
 * Each emitted file is FLAT (no [env.X] sections, no env metadata) so
 * `wrangler deploy --config dist/server/wrangler.<env>.json` works without
 * `--env` flags.
 *
 * Run automatically via the package's `build` script.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_SERVER = join(__dirname, '..', 'dist', 'server');

interface EnvOverrides {
  /** Worker name as it should appear in the CF dashboard. */
  name: string;
  /** Per-binding overrides. Keys are binding names (e.g. CONFIG_KV). */
  kvNamespaces: Record<string, string>;
  /** R2 bucket name overrides. Keys are binding names (e.g. ASSET_BUCKET). */
  r2Buckets: Record<string, string>;
}

/**
 * Source of truth for env overrides. Mirrors `[env.<name>]` in `wrangler.toml`.
 * Keep these in sync — they're only listed here too because the adapter
 * doesn't propagate the user toml's env sections to the generated config.
 */
const ENVS: Record<string, EnvOverrides> = {
  staging: {
    name: 'atomic-site-worker-staging',
    kvNamespaces: {
      CONFIG_KV: '4673c82cdd7f41d49e93d938fb1c6848', // CONFIG_KV_STAGING
    },
    r2Buckets: {
      ASSET_BUCKET: 'atl-assets-staging',
    },
  },
  production: {
    name: 'atomic-site-worker',
    kvNamespaces: {
      CONFIG_KV: 'a69cb2c59507482ca5e6d114babdd098', // CONFIG_KV (prod)
    },
    r2Buckets: {
      ASSET_BUCKET: 'atl-assets-prod',
    },
  },
};

interface KvBinding {
  binding: string;
  id?: string;
}

interface R2Binding {
  binding: string;
  bucket_name?: string;
}

interface WranglerConfig {
  name?: string;
  kv_namespaces?: KvBinding[];
  r2_buckets?: R2Binding[];
  definedEnvironments?: string[];
  topLevelName?: string;
  legacy_env?: boolean;
  [key: string]: unknown;
}

async function main(): Promise<void> {
  const baseRaw = await readFile(join(DIST_SERVER, 'wrangler.json'), 'utf-8');
  const base = JSON.parse(baseRaw) as WranglerConfig;

  for (const [envName, overrides] of Object.entries(ENVS)) {
    const config: WranglerConfig = JSON.parse(JSON.stringify(base));
    config.name = overrides.name;

    // Override KV namespace IDs by binding name. Leave any binding the env
    // doesn't override (e.g. SESSION) untouched — the adapter handles those.
    if (Array.isArray(config.kv_namespaces)) {
      config.kv_namespaces = config.kv_namespaces.map((b) => {
        const id = overrides.kvNamespaces[b.binding];
        return id ? { ...b, id } : b;
      });
    }

    // Same for R2 bucket names.
    if (Array.isArray(config.r2_buckets)) {
      config.r2_buckets = config.r2_buckets.map((b) => {
        const name = overrides.r2Buckets[b.binding];
        return name ? { ...b, bucket_name: name } : b;
      });
    }

    // Strip env metadata so the file is a self-contained flat config.
    delete config.definedEnvironments;
    delete config.topLevelName;
    delete config.legacy_env;

    const outPath = join(DIST_SERVER, `wrangler.${envName}.json`);
    await writeFile(outPath, JSON.stringify(config, null, 2), 'utf-8');

    const kvSummary = Object.entries(overrides.kvNamespaces)
      .map(([b, id]) => `${b}=${id.slice(0, 8)}…`)
      .join(', ');
    const r2Summary = Object.entries(overrides.r2Buckets)
      .map(([b, name]) => `${b}=${name}`)
      .join(', ');
    console.log(`[emit-env-configs] ${envName}: name=${overrides.name}, ${kvSummary}, ${r2Summary}`);
  }
}

void main().catch((err) => {
  console.error('[emit-env-configs] failed:', err);
  process.exit(1);
});
