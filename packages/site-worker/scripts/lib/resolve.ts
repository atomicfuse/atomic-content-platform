/**
 * Pure helpers used by `scripts/seed-kv.ts` (and by the unit tests).
 * Anything in this file must be:
 *   - synchronous OR pure-promise (no fs / network / wrangler calls);
 *   - deterministic given identical inputs;
 *   - importable by both the script and `vitest` without extra setup.
 *
 * Side-effecting helpers (file copy, KV writes, etc.) live in seed-kv.ts.
 */
import { parse as parseYaml } from 'yaml';

// ---------- Deep merge ----------

/**
 * Deep-merge two objects. Arrays in `b` REPLACE arrays in `a` (matching
 * the legacy site-builder semantics for `ad_placements`).
 *
 * `null` and `undefined` in `b` do NOT override values in `a` — they're
 * treated as "no value", which lets us splat optional layer overrides
 * over a defaulted base without erasing keys.
 *
 * `ads_txt` should ideally be additive across layers but this MVP keeps
 * replacement semantics — tracked in `docs/backlog/general.md` as a
 * Phase-7 follow-up.
 */
export function deepMerge(a: unknown, b: unknown): unknown {
  if (b === undefined || b === null) return a;
  if (
    typeof a !== 'object'
    || typeof b !== 'object'
    || Array.isArray(a)
    || Array.isArray(b)
    || a === null
  ) {
    return b;
  }
  const out: Record<string, unknown> = { ...(a as Record<string, unknown>) };
  for (const [k, v] of Object.entries(b as Record<string, unknown>)) {
    out[k] = deepMerge((a as Record<string, unknown>)[k], v);
  }
  return out;
}

// ---------- Merge modes ----------

/** Merge modes that a site or override layer can declare. */
export interface MergeModes {
  tracking?: 'merge' | 'replace';
  scripts?: 'merge_by_id' | 'replace';
  scripts_vars?: 'merge' | 'replace';
  ads_config?: 'add' | 'replace' | 'merge_placements';
  ads_txt?: 'add' | 'replace';
  theme?: 'merge' | 'replace';
  legal?: 'merge' | 'replace';
}

// ---------- Scripts merge-by-id ----------

interface ScriptEntryLike {
  id: string;
  [k: string]: unknown;
}

interface ScriptsLike {
  head?: ScriptEntryLike[];
  body_start?: ScriptEntryLike[];
  body_end?: ScriptEntryLike[];
}

const SCRIPT_POSITIONS = ['head', 'body_start', 'body_end'] as const;

/**
 * Merges `scripts` across config layers using merge-by-id semantics:
 *   - Same `id` in a later layer replaces the earlier entry.
 *   - New `id` is appended.
 *   - Layers without `scripts` (or with empty/missing position arrays) are skipped.
 *
 * This replaces the generic deepMerge array-replacement behaviour specifically
 * for the `scripts` field, matching the documented convention:
 *   "Scripts merge by ID across layers. Same ID = replace, new ID = append."
 *
 * If the **last layer** (the site) declares `merge_modes.scripts = 'replace'`,
 * only the site-layer scripts are returned (all inherited scripts are discarded).
 */
export function mergeScriptLayers(
  layers: ReadonlyArray<Record<string, unknown>>,
): { head: ScriptEntryLike[]; body_start: ScriptEntryLike[]; body_end: ScriptEntryLike[] } {
  // Check if the final layer wants "replace" mode.
  const last = layers[layers.length - 1];
  const lastModes = last?.merge_modes as MergeModes | undefined;
  if (lastModes?.scripts === 'replace') {
    const scripts = last.scripts as ScriptsLike | undefined;
    return {
      head: Array.isArray(scripts?.head) ? scripts.head : [],
      body_start: Array.isArray(scripts?.body_start) ? scripts.body_start : [],
      body_end: Array.isArray(scripts?.body_end) ? scripts.body_end : [],
    };
  }

  const result: Record<string, ScriptEntryLike[]> = {
    head: [],
    body_start: [],
    body_end: [],
  };
  for (const layer of layers) {
    const scripts = layer.scripts as ScriptsLike | undefined;
    if (!scripts || typeof scripts !== 'object') continue;
    for (const pos of SCRIPT_POSITIONS) {
      const entries = scripts[pos];
      if (!Array.isArray(entries) || entries.length === 0) continue;
      for (const entry of entries) {
        if (!entry || typeof entry !== 'object' || !entry.id) continue;
        const idx = result[pos].findIndex((e) => e.id === entry.id);
        if (idx >= 0) {
          result[pos][idx] = entry; // same ID → replace
        } else {
          result[pos].push(entry); // new ID → append
        }
      }
    }
  }
  return result as { head: ScriptEntryLike[]; body_start: ScriptEntryLike[]; body_end: ScriptEntryLike[] };
}

// ---------- Ads config merge ----------

interface AdPlacement {
  id: string;
  [k: string]: unknown;
}

/**
 * Merges `ads_config.ad_placements` across layers, respecting the site
 * layer's `merge_modes.ads_config`:
 *   - `'add'` (default): append site placements to inherited ones.
 *   - `'merge_placements'`: merge by id (same id → replace, new → append).
 *   - `'replace'`: only the site layer's placements are used.
 *
 * Non-placement fields (`interstitial`, `layout`) are always deep-merged
 * by the generic `deepMerge`; this function only handles the array.
 */
export function mergeAdPlacementLayers(
  layers: ReadonlyArray<Record<string, unknown>>,
): AdPlacement[] {
  const last = layers[layers.length - 1];
  const lastModes = last?.merge_modes as MergeModes | undefined;
  const mode = lastModes?.ads_config ?? 'add';

  // Collect placements from all layers except the last (site).
  const inherited: AdPlacement[] = [];
  for (let i = 0; i < layers.length - 1; i++) {
    const cfg = layers[i].ads_config as { ad_placements?: AdPlacement[] } | undefined;
    const placements = cfg?.ad_placements;
    if (!Array.isArray(placements)) continue;
    // Each non-site layer replaces inherited (deepMerge semantics for groups/overrides).
    inherited.length = 0;
    inherited.push(...placements);
  }

  const siteCfg = last?.ads_config as { ad_placements?: AdPlacement[] } | undefined;
  const sitePlacements = Array.isArray(siteCfg?.ad_placements) ? siteCfg.ad_placements : [];

  if (mode === 'replace') {
    return sitePlacements;
  }

  if (mode === 'merge_placements') {
    const result = [...inherited];
    for (const p of sitePlacements) {
      const idx = result.findIndex((r) => r.id === p.id);
      if (idx >= 0) {
        result[idx] = p;
      } else {
        result.push(p);
      }
    }
    return result;
  }

  // 'add' (default): append — even duplicate IDs.
  return [...inherited, ...sitePlacements];
}

// ---------- Frontmatter ----------

export interface FrontmatterSplit {
  front: Record<string, unknown>;
  body: string;
}

/**
 * Splits a markdown file with optional YAML frontmatter into its parts.
 * Returns `{ front: {}, body: raw }` if there's no frontmatter or the
 * delimiters don't match. Tolerates CRLF.
 */
export function splitFrontmatter(raw: string): FrontmatterSplit {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!match) return { front: {}, body: raw };
  const front = (parseYaml(match[1] ?? '') as Record<string, unknown> | null) ?? {};
  return { front, body: match[2] ?? '' };
}

// ---------- Asset URL rewriting ----------

/**
 * Rewrites `/assets/...` references in HTML to `/<siteId>/assets/...` so
 * they resolve against the per-site bundle dir under `public/<siteId>/assets/`.
 *
 * Touches `src=`, `href=`, and markdown-style `(/assets/...)`. Leaves
 * absolute URLs (`https://…/assets/…`) and other paths untouched.
 *
 * Idempotent — calling twice with the same siteId is a no-op (the
 * already-prefixed path doesn't match `/assets/` at the start).
 */
export function rewriteAssetUrls(html: string, siteId: string): string {
  const prefix = `/${siteId}/assets/`;
  return html
    .replace(/(\bsrc\s*=\s*["'])\/assets\//g, `$1${prefix}`)
    .replace(/(\bhref\s*=\s*["'])\/assets\//g, `$1${prefix}`)
    .replace(/(\()\/assets\//g, `$1${prefix}`);
}

/**
 * Rewrites a single URL field (e.g. `frontmatter.featuredImage`) the same
 * way `rewriteAssetUrls` does for HTML. Returns `undefined` for
 * `undefined`/missing input so callers don't have to guard.
 */
export function rewriteFrontmatterUrl(url: string | undefined, siteId: string): string | undefined {
  if (!url) return url;
  if (url.startsWith('/assets/')) return `/${siteId}/assets${url.slice('/assets'.length)}`;
  return url;
}

// ---------- Targeted overrides (overrides/config layer) ----------

/**
 * A targeted config override loaded from `overrides/config/<id>.yaml`.
 * The schema is the legacy site-builder's — see CLAUDE.md "Layer 3:
 * `overrides/config/<id>.yaml` — Targeted Config Exceptions".
 */
export interface OverrideConfig extends Record<string, unknown> {
  override_id?: string;
  name?: string;
  /** Lowest priority is applied FIRST; highest LAST (so it wins). */
  priority?: number;
  targets?: { groups?: string[]; sites?: string[] };
}

/**
 * Filters the list of all overrides down to those that target the given site
 * (by site id OR by intersection with the site's group list), then sorts
 * lowest-priority-first (so higher-priority overrides apply on top).
 *
 * Per CLAUDE.md: "lowest first, highest wins."
 */
export function selectMatchingOverrides(
  overrides: OverrideConfig[],
  siteId: string,
  siteGroups: readonly string[],
): OverrideConfig[] {
  const matching = overrides.filter((o) => {
    const t = o.targets ?? {};
    const sites = Array.isArray(t.sites) ? t.sites : [];
    const groups = Array.isArray(t.groups) ? t.groups : [];
    if (sites.includes(siteId)) return true;
    if (groups.some((g) => siteGroups.includes(g))) return true;
    return false;
  });
  return [...matching].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
}

/**
 * Override files use `_mode: merge|replace|add|merge_by_id|merge_placements`
 * directives inside fields to control how the legacy resolver merges them.
 * We do plain deep-merge (with array-replacement) which approximates
 * `_mode: replace` for arrays and `_mode: merge` for objects — covers the
 * common cases. The `_mode` keys themselves should NOT leak into KV; this
 * helper strips them recursively.
 */
export function stripModeKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((v) => stripModeKeys(v));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === '_mode' || k === '_values') continue;
      out[k] = stripModeKeys(v);
    }
    return out;
  }
  return value;
}

/**
 * Override layers carry meta-fields (`override_id`, `name`, `priority`,
 * `targets`) that the merged site-config shouldn't keep. Strip them.
 */
export function stripOverrideMetaFields(config: Record<string, unknown>): Record<string, unknown> {
  const { override_id, name, priority, targets, ...rest } = config;
  // Reference the destructured names so the lint rule for unused vars
  // doesn't fire — we genuinely want them dropped.
  void override_id; void name; void priority; void targets;
  return rest;
}
