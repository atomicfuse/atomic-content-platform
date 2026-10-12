import { readFile as readFs } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import type { AgentConfig } from "../lib/config.js";
import { createOctokit, parseRepo } from "../lib/github.js";
import { normalizeSiteAuthors, type SiteAuthor } from "./bylines.js";

/**
 * Bylines read straight from GitHub (Contents API), never through the pipeline's tree cache: that cache has no
 * expiry, so an author or a site's `authors:` saved after it was filled would stay invisible and articles would
 * fall back to the old name.
 */
async function readFresh(config: AgentConfig, filePath: string, ref: string): Promise<string | null> {
  const { owner, repo } = parseRepo(config.networkRepo);
  try {
    const { data } = await createOctokit(config.github).repos.getContent({ owner, repo, path: filePath, ref });
    return "content" in data && typeof data.content === "string" ? Buffer.from(data.content, "base64").toString("utf8") : null;
  } catch (err) {
    if ((err as { status?: number }).status === 404) return null;
    throw err;
  }
}

/**
 * Reads `authors/<id>.yaml` from the network repo `main`. The local checkout (LOCAL_NETWORK_PATH) is used only for
 * runs that also write locally (no branch); a run writing to a git branch always reads GitHub, since the local
 * path may be missing or behind.
 */
export function authorFileReader(config: AgentConfig, branch?: string): (id: string) => Promise<string | null> {
  if (config.localNetworkPath && !branch) {
    return (id) => readFs(path.join(config.localNetworkPath!, "authors", `${id}.yaml`), "utf8").catch(() => null);
  }
  // Only "no such file" means no profile; any other error is thrown so the resolver retries on the next article.
  return (id) => readFresh(config, `authors/${id}.yaml`, "main");
}

/** The site's current `authors:` from its branch's site.yaml; null when it can't be read (use the brief's). */
export function siteAuthorsReader(config: AgentConfig): (siteDomain: string, branch?: string) => Promise<SiteAuthor[] | null> {
  return async (siteDomain, branch) => {
    // Local checkout without a branch: the brief was just read from disk, so it is already current.
    if (config.localNetworkPath && !branch) return null;
    try {
      const raw = await readFresh(config, `sites/${siteDomain}/site.yaml`, branch ?? "main");
      if (!raw) return null;
      const doc = parseYaml(raw) as { authors?: unknown } | null;
      return normalizeSiteAuthors(doc?.authors);
    } catch {
      return null;
    }
  };
}
