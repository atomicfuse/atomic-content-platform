import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { commitNetworkFiles, readFileContent } from "@/lib/github";
import type { SimilarwebStatus } from "./types";

/**
 * Latest Similarweb result per site, kept in the network repo (main) so the local and production
 * dashboards see the same data. Root-level file: no sync workflow watches it.
 */
export const SIMILARWEB_FILE = "similarweb.yaml";

const HEADER = "# Similarweb status per site — written by the dashboard (Sites → Update Similarweb data). Don't edit by hand.\n";

function toStatus(site: string, raw: unknown): SimilarwebStatus | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    site,
    domain: typeof r.domain === "string" ? r.domain : "",
    has_rank: r.has_rank === true,
    global_rank: num(r.global_rank),
    monthly_visits: num(r.monthly_visits),
    checked_at: typeof r.checked_at === "string" ? r.checked_at : "",
    source: r.source === "api" ? "api" : "manual",
  };
}

export async function readSimilarwebStatuses(): Promise<Record<string, SimilarwebStatus>> {
  const raw = await readFileContent(SIMILARWEB_FILE, "main");
  if (!raw) return {};
  let doc: unknown;
  try {
    doc = parseYaml(raw);
  } catch {
    console.warn(`[similarweb] ${SIMILARWEB_FILE} is not valid YAML — showing no data`);
    return {};
  }
  const sites = doc && typeof doc === "object" ? (doc as { sites?: unknown }).sites : undefined;
  if (!sites || typeof sites !== "object" || Array.isArray(sites)) return {};
  const out: Record<string, SimilarwebStatus> = {};
  for (const [site, value] of Object.entries(sites as Record<string, unknown>)) {
    const status = toStatus(site, value);
    if (status) out[site] = status;
  }
  return out;
}

export async function readSimilarwebStatus(site: string): Promise<SimilarwebStatus | null> {
  return (await readSimilarwebStatuses())[site] ?? null;
}

/** Merge new results into the file (other sites keep theirs) and commit it once. */
export async function upsertSimilarwebStatuses(statuses: SimilarwebStatus[]): Promise<void> {
  if (statuses.length === 0) return;
  const current = await readSimilarwebStatuses();
  for (const s of statuses) current[s.site] = s;
  const sites = Object.fromEntries(
    Object.keys(current).sort().map((site) => {
      const { site: _id, ...rest } = current[site]!;
      return [site, rest];
    }),
  );
  await commitNetworkFiles(
    [{ path: SIMILARWEB_FILE, content: HEADER + stringifyYaml({ sites }, { lineWidth: 0 }) }],
    `dashboard: update Similarweb data (${statuses.length} sites)`,
    "main",
  );
}
