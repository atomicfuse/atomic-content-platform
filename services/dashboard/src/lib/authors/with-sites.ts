import { connectedSitesByAuthor } from "./connected";
import { parse as parseYaml } from "yaml";
import { listSiteConfigs } from "@/lib/db/site-configs";
import { getDashboardIndex } from "@/lib/db/dashboard-index";
import { readFileContent } from "@/lib/github";
import { NETWORK_REPO_NAME, NETWORK_REPO_OWNER } from "@/lib/constants";
import type { AuthorListItem, AuthorRecord } from "./types";

/** Authors + the sites using each (site configs; empty locally where Mongo reads are off). */
export async function withSites(authors: AuthorRecord[]): Promise<AuthorListItem[]> {
  const configs = await listSiteConfigs().catch(() => []);
  const map = connectedSitesByAuthor(configs);
  return authors.map((a) => ({ ...a, sites: map.get(a.id) ?? [] }));
}

/**
 * The sites using one author, for decisions that must not guess (delete). With Mongo reads (production) it reads
 * the site configs there; without them (local grid dev, which still writes to the real network repo) it reads each
 * site's site.yaml from its staging branch, fresh from git. Throws when any of that can't be read.
 */
export async function connectedSitesStrict(id: string): Promise<string[]> {
  let configs: Array<Record<string, unknown>>;
  if (process.env.USE_MONGO_READS === "true") {
    configs = await listSiteConfigs();
  } else {
    const { sites } = await getDashboardIndex({ fresh: true });
    const network = { owner: NETWORK_REPO_OWNER, name: NETWORK_REPO_NAME };
    configs = (await Promise.all(sites.map(async ({ domain }) => {
      const raw = await readFileContent(`sites/${domain}/site.yaml`, `staging/${domain}`, network)
        ?? await readFileContent(`sites/${domain}/site.yaml`, "main", network);
      const parsed: unknown = raw ? parseYaml(raw) : null;
      return parsed && typeof parsed === "object" ? ({ ...(parsed as Record<string, unknown>), domain } as Record<string, unknown>) : null;
    }))).filter((c): c is Record<string, unknown> => c !== null);
  }
  return (connectedSitesByAuthor(configs).get(id) ?? []).map((s) => s.site);
}
