import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

export interface CustomDomainRoute {
  pattern: string;
  custom_domain: true;
}

interface IndexEntry {
  domain: string;
  custom_domain?: string | null;
}

interface DashboardIndex {
  sites?: IndexEntry[];
  deleted?: IndexEntry[];
}

/** Read `<networkPath>/dashboard-index.yaml` and return a route entry for
 *  every active site whose `custom_domain` is set. Used by emit-env-configs.ts
 *  to register Workers Custom Domains at production build time. */
export async function loadCustomDomains(networkPath: string): Promise<CustomDomainRoute[]> {
  const filePath = join(networkPath, 'dashboard-index.yaml');
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf-8');
  } catch (err) {
    throw new Error(`Failed to read dashboard-index.yaml at ${filePath}: ${(err as Error).message}`);
  }
  const index = parseYaml(raw) as DashboardIndex | null;
  const sites = index?.sites ?? [];
  return sites
    .filter((s): s is IndexEntry & { custom_domain: string } =>
      typeof s.custom_domain === 'string' && s.custom_domain.length > 0,
    )
    .map((s) => ({ pattern: s.custom_domain, custom_domain: true as const }));
}
