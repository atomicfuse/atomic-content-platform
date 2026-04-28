import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

export interface CustomDomainRoute {
  pattern: string;
  custom_domain: true;
}

interface IndexEntry {
  custom_domain?: string | null;
}

interface DashboardIndex {
  sites?: IndexEntry[];
}

/** Read `<networkPath>/dashboard-index.yaml` and return a route entry for
 *  every entry in `sites:` whose `custom_domain` is set. Used by
 *  emit-env-configs.ts to register Workers Custom Domains at production
 *  build time. */
export async function loadCustomDomains(networkPath: string): Promise<CustomDomainRoute[]> {
  const filePath = join(networkPath, 'dashboard-index.yaml');
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf-8');
  } catch (err) {
    throw new Error(`Failed to read dashboard-index.yaml at ${filePath}: ${(err as Error).message}`);
  }
  const parsed = parseYaml(raw);
  if (parsed !== null && parsed !== undefined) {
    if (typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(
        `dashboard-index.yaml at ${filePath} did not parse to an object ` +
        `(got ${Array.isArray(parsed) ? 'array' : typeof parsed}). ` +
        `The file may be corrupted.`,
      );
    }
  }
  const index = parsed as DashboardIndex | null;
  const sites = index?.sites;
  if (sites !== undefined && !Array.isArray(sites)) {
    throw new Error(
      `dashboard-index.yaml at ${filePath} has a \`sites\` field but it's not an array.`,
    );
  }
  return (sites ?? [])
    .filter((s): s is IndexEntry & { custom_domain: string } =>
      typeof s.custom_domain === 'string' && s.custom_domain.length > 0,
    )
    .map((s) => ({ pattern: s.custom_domain, custom_domain: true as const }));
}
