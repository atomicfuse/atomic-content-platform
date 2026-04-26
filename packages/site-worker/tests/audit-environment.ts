#!/usr/bin/env tsx
/**
 * Cross-system audit script.
 *
 * One-shot diagnostic that talks to Cloudflare + GitHub APIs and reports
 * whether the migration's runtime state is what we expect. Exit code 0
 * if all required checks pass, non-zero if any fail.
 *
 * Run before:
 *   - a Phase-7 cutover (sanity check)
 *   - investigating "site is broken" reports
 *   - writing a session summary that claims the system is healthy
 *
 * Required env:
 *   CLOUDFLARE_ACCOUNT_ID  — Dev1 (953511f6...)
 *   CLOUDFLARE_API_TOKEN   — token with Workers Scripts:Read +
 *                            Workers KV Storage:Read + Pages:Read
 *   GH_TOKEN  (optional)   — defaults to whatever `gh auth status` provides
 *
 * Output: human-readable checklist with ✓ / ⚠ / ✗ markers + a final
 * summary count. Non-zero exit means at least one ✗.
 */
import { execSync } from 'node:child_process';

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const NETWORK_REPO = 'atomicfuse/atomic-labs-network';
const PLATFORM_REPO = 'atomicfuse/atomic-content-platform';

interface ExpectedKv {
  binding: string;
  id: string;
  description: string;
}

interface ExpectedWorker {
  name: string;
  expectedKv: Record<string, string>; // binding → namespace id
  expectedR2: Record<string, string>; // binding → bucket name
}

const EXPECTED_KV: ExpectedKv[] = [
  { binding: 'CONFIG_KV_STAGING', id: '4673c82cdd7f41d49e93d938fb1c6848', description: 'staging' },
  { binding: 'CONFIG_KV', id: 'a69cb2c59507482ca5e6d114babdd098', description: 'prod' },
];

const EXPECTED_R2_BUCKETS: Array<{ name: string; description: string }> = [
  { name: 'atl-assets-staging', description: 'staging' },
  { name: 'atl-assets-prod', description: 'prod' },
];

const EXPECTED_WORKERS: ExpectedWorker[] = [
  {
    name: 'atomic-site-worker-staging',
    expectedKv: { CONFIG_KV: '4673c82cdd7f41d49e93d938fb1c6848' },
    expectedR2: { ASSET_BUCKET: 'atl-assets-staging' },
  },
  {
    name: 'atomic-site-worker',
    expectedKv: { CONFIG_KV: 'a69cb2c59507482ca5e6d114babdd098' },
    expectedR2: { ASSET_BUCKET: 'atl-assets-prod' },
  },
];

const REQUIRED_NETWORK_SECRETS = [
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_ACCOUNT_ID',
  'PLATFORM_REPO_TOKEN',
  'KV_NAMESPACE_ID_STAGING',
  'KV_NAMESPACE_ID_PROD',
];

interface Check {
  status: 'pass' | 'warn' | 'fail';
  message: string;
}

const checks: Check[] = [];
const pass = (m: string): void => { checks.push({ status: 'pass', message: m }); console.log(`✓ ${m}`); };
const warn = (m: string): void => { checks.push({ status: 'warn', message: m }); console.log(`⚠ ${m}`); };
const fail = (m: string): void => { checks.push({ status: 'fail', message: m }); console.log(`✗ ${m}`); };

async function cf<T>(path: string): Promise<T> {
  const url = `https://api.cloudflare.com/client/v4${path}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
  const body = await res.json() as { success: boolean; result: T; errors?: Array<{ message: string }> };
  if (!body.success) {
    throw new Error(`CF API ${path}: ${body.errors?.map((e) => e.message).join(', ') ?? 'unknown'}`);
  }
  return body.result;
}

async function checkAuth(): Promise<boolean> {
  if (!ACCOUNT_ID) { fail('CLOUDFLARE_ACCOUNT_ID env not set'); return false; }
  if (!TOKEN) { fail('CLOUDFLARE_API_TOKEN env not set'); return false; }
  try {
    const verify = await cf<{ status: string }>('/user/tokens/verify');
    if (verify.status !== 'active') { fail(`CF token status: ${verify.status}`); return false; }
    pass(`CF token active; account ${ACCOUNT_ID.slice(0, 8)}…`);
    return true;
  } catch (err) {
    fail(`CF auth failed: ${(err as Error).message}`);
    return false;
  }
}

async function checkKvNamespaces(): Promise<void> {
  const ns = await cf<Array<{ id: string; title: string }>>(`/accounts/${ACCOUNT_ID}/storage/kv/namespaces?per_page=100`);
  for (const expected of EXPECTED_KV) {
    const found = ns.find((n) => n.id === expected.id);
    if (found) {
      pass(`KV namespace ${expected.binding} (${expected.description}) → ${expected.id.slice(0, 8)}… present as "${found.title}"`);
    } else {
      fail(`KV namespace ${expected.id} (${expected.description}) NOT FOUND on this account`);
    }
  }

  // Per-namespace key shape sanity check
  for (const expected of EXPECTED_KV) {
    try {
      const keys = await cf<Array<{ name: string }>>(`/accounts/${ACCOUNT_ID}/storage/kv/namespaces/${expected.id}/keys?prefix=site-config:`);
      if (keys.length >= 1) pass(`  ${expected.description} has ${keys.length} site-config key(s)`);
      else warn(`  ${expected.description} has zero site-config keys (unseeded?)`);

      const articleIndex = await cf<Array<{ name: string }>>(`/accounts/${ACCOUNT_ID}/storage/kv/namespaces/${expected.id}/keys?prefix=article-index:`);
      if (articleIndex.length >= 1) pass(`  ${expected.description} has ${articleIndex.length} article-index key(s)`);
      else warn(`  ${expected.description} has zero article-index keys (unseeded?)`);
    } catch (err) {
      fail(`  ${expected.description} key listing failed: ${(err as Error).message}`);
    }
  }
}

async function checkR2Buckets(): Promise<void> {
  const buckets = await cf<{ buckets: Array<{ name: string }> }>(
    `/accounts/${ACCOUNT_ID}/r2/buckets`,
  );
  const names = new Set(buckets.buckets.map((b) => b.name));
  for (const expected of EXPECTED_R2_BUCKETS) {
    if (names.has(expected.name)) {
      pass(`R2 bucket ${expected.name} (${expected.description}) present`);
    } else {
      fail(`R2 bucket ${expected.name} (${expected.description}) NOT FOUND on this account`);
    }
  }
}

async function checkWorkers(): Promise<void> {
  const scripts = await cf<Array<{ id: string }>>(`/accounts/${ACCOUNT_ID}/workers/scripts`);
  const names = new Set(scripts.map((s) => s.id));

  for (const expected of EXPECTED_WORKERS) {
    if (names.has(expected.name)) {
      pass(`Worker "${expected.name}" deployed`);

      // Inspect bindings
      try {
        const bindings = await cf<Array<{ type: string; name: string; namespace_id?: string; bucket_name?: string }>>(`/accounts/${ACCOUNT_ID}/workers/scripts/${expected.name}/bindings`);
        for (const [binding, expectedId] of Object.entries(expected.expectedKv)) {
          const b = bindings.find((x) => x.name === binding && x.type === 'kv_namespace');
          if (!b) {
            fail(`  ${expected.name}: missing KV binding "${binding}"`);
          } else if (b.namespace_id !== expectedId) {
            fail(`  ${expected.name}: ${binding} → ${b.namespace_id?.slice(0, 8)}… (expected ${expectedId.slice(0, 8)}…)`);
          } else {
            pass(`  ${expected.name}: ${binding} → ${expectedId.slice(0, 8)}… ✓`);
          }
        }
        for (const [binding, expectedBucket] of Object.entries(expected.expectedR2)) {
          const b = bindings.find((x) => x.name === binding && x.type === 'r2_bucket');
          if (!b) {
            fail(`  ${expected.name}: missing R2 binding "${binding}"`);
          } else if (b.bucket_name !== expectedBucket) {
            fail(`  ${expected.name}: ${binding} → ${b.bucket_name} (expected ${expectedBucket})`);
          } else {
            pass(`  ${expected.name}: ${binding} → ${expectedBucket} ✓`);
          }
        }
      } catch (err) {
        warn(`  ${expected.name}: couldn't read bindings (${(err as Error).message})`);
      }
    } else {
      fail(`Worker "${expected.name}" NOT deployed`);
    }
  }

  // Flag unexpected `atomic-*` Workers (cleanup leftovers).
  const unexpected = [...names].filter((n) => n.startsWith('atomic-') && !EXPECTED_WORKERS.some((w) => w.name === n));
  if (unexpected.length > 0) {
    warn(`unexpected atomic-* Workers (cleanup candidates): ${unexpected.join(', ')}`);
  }
}

function checkSecrets(): void {
  try {
    const out = execSync(`gh secret list --repo ${NETWORK_REPO} --json name`, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
    const present = (JSON.parse(out) as Array<{ name: string }>).map((s) => s.name);
    for (const required of REQUIRED_NETWORK_SECRETS) {
      if (present.includes(required)) pass(`Network repo secret ${required} set`);
      else fail(`Network repo secret ${required} MISSING`);
    }
  } catch (err) {
    warn(`Couldn't list secrets via gh (${(err as Error).message}). Run \`gh auth login\` and ensure PAT has secrets:read permission.`);
  }
}

function checkLatestWorkflow(workflow: string, repo: string): void {
  try {
    const out = execSync(`gh run list --repo ${repo} --workflow=${workflow} --limit 1 --json conclusion,headBranch,createdAt`, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const arr = JSON.parse(out) as Array<{ conclusion: string; headBranch: string; createdAt: string }>;
    if (arr.length === 0) {
      warn(`${repo} ${workflow}: no runs yet`);
      return;
    }
    const r = arr[0]!;
    if (r.conclusion === 'success') pass(`${repo} ${workflow}: latest run on ${r.headBranch} succeeded (${r.createdAt})`);
    else fail(`${repo} ${workflow}: latest run on ${r.headBranch} = ${r.conclusion} (${r.createdAt})`);
  } catch (err) {
    warn(`Couldn't list ${workflow} runs via gh (${(err as Error).message})`);
  }
}

async function main(): Promise<void> {
  console.log('=== Cloudflare ===');
  const authed = await checkAuth();
  if (authed) {
    await checkKvNamespaces();
    await checkR2Buckets();
    await checkWorkers();
  }

  console.log('\n=== GitHub: network-repo secrets ===');
  checkSecrets();

  console.log('\n=== GitHub: latest CI runs ===');
  checkLatestWorkflow('sync-kv.yml', NETWORK_REPO);
  checkLatestWorkflow('deploy.yml', NETWORK_REPO);

  console.log('\n=== Summary ===');
  const passes = checks.filter((c) => c.status === 'pass').length;
  const warns = checks.filter((c) => c.status === 'warn').length;
  const fails = checks.filter((c) => c.status === 'fail').length;
  console.log(`pass: ${passes}  warn: ${warns}  fail: ${fails}`);

  if (fails > 0) process.exit(1);
}

void main().catch((err) => {
  console.error('audit failed:', err);
  process.exit(1);
});
