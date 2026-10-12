import { connectedSitesByAuthor } from "./connected";
import { parse as parseYaml } from "yaml";
import { listSiteConfigs } from "@/lib/db/site-configs";
import { getDashboardIndex } from "@/lib/db/dashboard-index";
import { readFileContent } from "@/lib/github";
import { NETWORK_REPO_NAME, NETWORK_REPO_OWNER } from "@/lib/constants";
import type { AuthorListItem, AuthorRecord } from "./types";

const mongoReads = (): boolean => process.env.USE_MONGO_READS === "true";

/**
 * Every site's site.yaml from git (its staging branch, else main), fresh. Used where Mongo reads are off (local grid
 * dev, which still writes to the real network repo). Throws when a read fails.
 */
async function siteConfigsFromGit(): Promise<Array<Record<string, unknown>>> {
  const { sites } = await getDashboardIndex({ fresh: true });
  const network = { owner: NETWORK_REPO_OWNER, name: NETWORK_REPO_NAME };
  return (await Promise.all(sites.map(async ({ domain }) => {
    const raw = await readFileContent(`sites/${domain}/site.yaml`, `staging/${domain}`, network)
      ?? await readFileContent(`sites/${domain}/site.yaml`, "main", network);
    const parsed: unknown = raw ? parseYaml(raw) : null;
    return parsed && typeof parsed === "object" ? ({ ...(parsed as Record<string, unknown>), domain } as Record<string, unknown>) : null;
  }))).filter((c): c is Record<string, unknown> => c !== null);
}

const GIT_CACHE_MS = 60_000;
let gitCache: { at: number; configs: Promise<Array<Record<string, unknown>>> } | null = null;

/** Call after saving a site's authors so the next list shows them. */
export function invalidateConnectedSites(): void {
  gitCache = null;
}

/** Display only: a minute-old git read is fine, and a failed read shows no sites rather than failing the page. */
async function siteConfigsForDisplay(): Promise<Array<Record<string, unknown>>> {
  if (mongoReads()) return listSiteConfigs().catch(() => []);
  if (!gitCache || Date.now() - gitCache.at > GIT_CACHE_MS) {
    const configs = siteConfigsFromGit();
    gitCache = { at: Date.now(), configs };
    configs.catch(() => { gitCache = null; });
  }
  return gitCache.configs.catch(() => []);
}

/** Authors + the sites using each (site configs from Mongo in production, from git locally). */
export async function withSites(authors: AuthorRecord[]): Promise<AuthorListItem[]> {
  const map = connectedSitesByAuthor(await siteConfigsForDisplay());
  return authors.map((a) => ({ ...a, sites: map.get(a.id) ?? [] }));
}

/**
 * The sites using one author, for decisions that must not guess (delete). Mongo in production; locally each site's
 * site.yaml read fresh from git (never the display cache). Throws when any of that can't be read.
 */
export async function connectedSitesStrict(id: string): Promise<string[]> {
  const configs = mongoReads() ? await listSiteConfigs() : await siteConfigsFromGit();
  return (connectedSitesByAuthor(configs).get(id) ?? []).map((s) => s.site);
}
