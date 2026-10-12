import type { ConnectedSite } from "./types";

/** Site configs (Mongo in production) → author id → the sites that list them in `authors`. */
export function connectedSitesByAuthor(configs: Array<Record<string, unknown>>): Map<string, ConnectedSite[]> {
  const map = new Map<string, ConnectedSite[]>();
  for (const cfg of configs) {
    const site = typeof cfg.domain === "string" ? cfg.domain : null;
    if (!site || !Array.isArray(cfg.authors)) continue;
    for (const entry of cfg.authors) {
      if (!entry || typeof entry !== "object" || typeof (entry as { id?: unknown }).id !== "string") continue;
      const { id, topics } = entry as { id: string; topics?: unknown };
      const list = map.get(id) ?? [];
      list.push({ site, topics: Array.isArray(topics) ? topics.filter((t): t is string => typeof t === "string") : [] });
      map.set(id, list);
    }
  }
  return map;
}
