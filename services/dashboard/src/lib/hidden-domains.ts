import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { commitNetworkFiles, readFileContent } from "@/lib/github";

/**
 * Cloudflare zones the platform should ignore (not offered in the Attach Domain picker),
 * kept in the network repo (main) so the local and production dashboards agree.
 * Root-level file: no sync workflow watches it.
 */
export const HIDDEN_DOMAINS_FILE = "hidden-domains.yaml";

const HEADER = "# Cloudflare domains hidden from the site platform — written by the dashboard (Settings → Domains).\n";

/** Hidden zone names. A missing or hand-broken file means nothing is hidden. */
export async function readHiddenDomains(): Promise<Set<string>> {
  const raw = await readFileContent(HIDDEN_DOMAINS_FILE, "main");
  if (!raw) return new Set();
  let doc: unknown;
  try {
    doc = parseYaml(raw);
  } catch {
    console.warn(`[hidden-domains] ${HIDDEN_DOMAINS_FILE} is not valid YAML — hiding nothing`);
    return new Set();
  }
  const list = doc && typeof doc === "object" ? (doc as { domains?: unknown }).domains : undefined;
  if (!Array.isArray(list)) return new Set();
  return new Set(list.filter((d): d is string => typeof d === "string").map((d) => d.trim().toLowerCase()));
}

/** Add or remove one domain and commit the file. No-op when nothing changes. */
export async function setDomainHidden(domain: string, hidden: boolean): Promise<void> {
  const name = domain.trim().toLowerCase();
  const current = await readHiddenDomains();
  if (current.has(name) === hidden) return;
  if (hidden) current.add(name);
  else current.delete(name);
  await commitNetworkFiles(
    [{ path: HIDDEN_DOMAINS_FILE, content: HEADER + stringifyYaml({ domains: [...current].sort() }) }],
    `dashboard: ${hidden ? "hide" : "unhide"} domain ${name}`,
    "main",
  );
}
