import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCustomDomains } from '../../scripts/lib/load-routes';

async function withFakeNetwork<T>(yaml: string, fn: (path: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'atl-load-routes-'));
  await writeFile(join(dir, 'dashboard-index.yaml'), yaml, 'utf-8');
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('loadCustomDomains', () => {
  it('returns one custom-domain route per site with non-null custom_domain', async () => {
    const yaml = `
sites:
  - domain: site-a
    custom_domain: a.example.com
  - domain: site-b
    custom_domain: null
  - domain: site-c
    custom_domain: c.example.com
`;
    await withFakeNetwork(yaml, async (dir) => {
      const routes = await loadCustomDomains(dir);
      expect(routes).toEqual([
        { pattern: 'a.example.com', custom_domain: true },
        { pattern: 'c.example.com', custom_domain: true },
      ]);
    });
  });

  it('returns empty array when no sites have custom_domain', async () => {
    const yaml = `
sites:
  - domain: site-a
    custom_domain: null
`;
    await withFakeNetwork(yaml, async (dir) => {
      expect(await loadCustomDomains(dir)).toEqual([]);
    });
  });

  it('throws when dashboard-index.yaml is missing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'atl-load-routes-empty-'));
    try {
      await expect(loadCustomDomains(dir)).rejects.toThrow(/dashboard-index\.yaml/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('skips entries in `deleted:` (only `sites:` matter)', async () => {
    const yaml = `
sites:
  - domain: live
    custom_domain: live.example.com
deleted:
  - domain: dead
    custom_domain: dead.example.com
    deleted_at: '2026-01-01T00:00:00Z'
`;
    await withFakeNetwork(yaml, async (dir) => {
      const routes = await loadCustomDomains(dir);
      expect(routes).toEqual([{ pattern: 'live.example.com', custom_domain: true }]);
    });
  });

  it('throws when dashboard-index.yaml parses to a non-object root', async () => {
    // YAML where the root is a scalar (string), not a mapping.
    await withFakeNetwork('"just a string"\n', async (dir) => {
      await expect(loadCustomDomains(dir)).rejects.toThrow(/did not parse to an object/);
    });
  });

  it('throws when `sites:` is present but not an array', async () => {
    const yaml = `
sites: oh-no-this-should-be-a-list
`;
    await withFakeNetwork(yaml, async (dir) => {
      await expect(loadCustomDomains(dir)).rejects.toThrow(/sites.*not an array/);
    });
  });

  it('returns [] for an empty file', async () => {
    await withFakeNetwork('', async (dir) => {
      expect(await loadCustomDomains(dir)).toEqual([]);
    });
  });
});
