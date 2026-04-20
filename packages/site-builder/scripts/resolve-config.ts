/**
 * Config Resolver for the Atomic Content Network Platform.
 *
 * Reads YAML config files from a network data repo, deep-merges them
 * following the inheritance chain:
 *
 *   org → groups[0] → groups[1] → … → overrides (by priority) → site
 *
 * Resolves all {{placeholder}} variables and returns a fully-typed
 * ResolvedConfig.
 *
 * Groups use standard merge semantics (deep merge, scripts merge by id,
 * ads_txt additive). Overrides use REPLACE semantics — if an override
 * defines a field, it completely replaces the group chain's value for
 * that field.
 */

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";

import type {
  OrgConfig,
  GroupConfig,
  SiteConfig,
  ResolvedConfig,
  ScriptsConfig,
  ResolvedThemeConfig,
  ThemeConfig,
  PreviewPageConfig,
  CategoryConfig,
  SidebarConfig,
  SearchConfig,
  OverrideConfig,
  InlineAdConfig,
  AdPlaceholderHeights,
  SimpleMergeMode,
  ScriptsMergeMode,
  AdsConfigMergeMode,
  AdsTxtMergeMode,
} from "@atomic-platform/shared-types";
import type { NetworkManifest } from "@atomic-platform/shared-types";
import type { ScriptEntry, AdsConfig, AdPlacement } from "@atomic-platform/shared-types";
import type { TrackingConfig } from "@atomic-platform/shared-types";

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_AD_PLACEHOLDER_HEIGHTS: AdPlaceholderHeights = {
  "above-content": 90,
  "after-paragraph": 280,
  sidebar: 600,
  "sticky-bottom": 50,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Read and parse a YAML file, throwing a descriptive error if not found.
 */
async function readYaml<T>(filePath: string): Promise<T> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new Error(`Config file not found: ${filePath}`);
    }
    throw err;
  }
  return parse(raw) as T;
}

async function readYamlOptional<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await readFile(filePath, "utf-8");
    return parse(raw) as T;
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    throw err;
  }
}

/**
 * Check whether a value is a plain object (not an array, not null).
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Deep-merge `source` into `target`, returning a new object.
 *
 * Rules:
 *  - Objects: recursively merge. Child keys override parent keys.
 *  - Arrays: child replaces parent entirely (no concatenation).
 *  - Null: explicitly setting a key to null clears the parent value.
 *  - `undefined` values in source are skipped (key not present).
 */
function deepMerge<T extends Record<string, unknown>>(
  target: T,
  source: Record<string, unknown>,
): T {
  const result: Record<string, unknown> = { ...target };

  for (const key of Object.keys(source)) {
    const srcVal = source[key];
    const tgtVal = result[key];

    if (srcVal === undefined) {
      continue;
    }

    if (srcVal === null) {
      // Explicit null clears parent value
      result[key] = null;
      continue;
    }

    if (isPlainObject(srcVal) && isPlainObject(tgtVal)) {
      result[key] = deepMerge(
        tgtVal as Record<string, unknown>,
        srcVal,
      );
    } else {
      result[key] = srcVal;
    }
  }

  return result as T;
}

// ---------------------------------------------------------------------------
// Script merging by ID
// ---------------------------------------------------------------------------

/**
 * Merge two script arrays by `id`. If the child defines a script with the
 * same id as the parent, the child's version replaces it. New ids are appended.
 */
function mergeScriptArrays(
  parent: ScriptEntry[],
  child: ScriptEntry[],
): ScriptEntry[] {
  const merged = new Map<string, ScriptEntry>();

  for (const entry of parent) {
    merged.set(entry.id, entry);
  }

  for (const entry of child) {
    merged.set(entry.id, entry);
  }

  return Array.from(merged.values());
}

/**
 * Merge scripts configs. Each position (head, body_start, body_end) is merged
 * by script id rather than being replaced wholesale.
 */
function mergeScriptsConfigs(
  parent: ScriptsConfig,
  child: Partial<ScriptsConfig>,
): ScriptsConfig {
  return {
    head: child.head
      ? mergeScriptArrays(parent.head, child.head)
      : parent.head,
    body_start: child.body_start
      ? mergeScriptArrays(parent.body_start, child.body_start)
      : parent.body_start,
    body_end: child.body_end
      ? mergeScriptArrays(parent.body_end, child.body_end)
      : parent.body_end,
  };
}

// ---------------------------------------------------------------------------
// Placeholder resolution
// ---------------------------------------------------------------------------

/**
 * Replace all `{{key}}` placeholders in a string using the provided vars map.
 */
function resolveString(
  value: string,
  vars: Record<string, string>,
): string {
  return value.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    return vars[key] ?? `{{${key}}}`;
  });
}

/**
 * Recursively walk an object/array and resolve all {{placeholder}} strings.
 */
function resolveTemplates(
  value: unknown,
  vars: Record<string, string>,
): unknown {
  if (typeof value === "string") {
    return resolveString(value, vars);
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolveTemplates(item, vars));
  }
  if (isPlainObject(value)) {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = resolveTemplates(v, vars);
    }
    return result;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Normalise YAML script entries to ScriptEntry interface
// ---------------------------------------------------------------------------

/**
 * YAML files may use `content` instead of `inline`, and `type` to indicate
 * external vs inline. Normalise to the ScriptEntry interface shape.
 */
function normaliseScriptEntry(raw: Record<string, unknown>): ScriptEntry {
  const entry: ScriptEntry = { id: raw["id"] as string };

  if (raw["src"] !== undefined) {
    entry.src = raw["src"] as string;
  }
  // YAML uses `content` for inline scripts
  if (raw["content"] !== undefined) {
    entry.inline = raw["content"] as string;
  }
  if (raw["inline"] !== undefined) {
    entry.inline = raw["inline"] as string;
  }
  if (raw["async"] !== undefined) {
    entry.async = raw["async"] as boolean;
  }

  return entry;
}

function normaliseScriptArray(arr: unknown[]): ScriptEntry[] {
  return arr.map((item) =>
    normaliseScriptEntry(item as Record<string, unknown>),
  );
}

function normaliseScriptsConfig(raw: Record<string, unknown>): ScriptsConfig {
  return {
    head: normaliseScriptArray((raw["head"] as unknown[] | undefined) ?? []),
    body_start: normaliseScriptArray(
      (raw["body_start"] as unknown[] | undefined) ?? [],
    ),
    body_end: normaliseScriptArray(
      (raw["body_end"] as unknown[] | undefined) ?? [],
    ),
  };
}

// ---------------------------------------------------------------------------
// Ad placement normalization
// ---------------------------------------------------------------------------

/**
 * Normalize ad placements from YAML-friendly format to typed format.
 * Handles:
 *  - `devices` → `device` (field rename)
 *  - `sizes: ["728x90"]` (string array) → `sizes: { desktop: [[728, 90]], mobile: [] }`
 *  - Already-normalized tuple format passes through unchanged (idempotent)
 */
function normaliseAdPlacements(placements: unknown[]): AdPlacement[] {
  return placements.map((raw) => {
    const p = raw as Record<string, unknown>;
    const id = p["id"] as string;
    const position = p["position"] as string;

    // Normalize device/devices field
    const device = (p["device"] ?? p["devices"] ?? "all") as "all" | "desktop" | "mobile";

    // Normalize sizes
    let sizes: { desktop?: number[][]; mobile?: number[][] };
    const rawSizes = p["sizes"];

    if (rawSizes && typeof rawSizes === "object" && !Array.isArray(rawSizes)) {
      // Already in { desktop: [...], mobile: [...] } format
      sizes = rawSizes as { desktop?: number[][]; mobile?: number[][] };
    } else if (Array.isArray(rawSizes)) {
      // String array like ["728x90", "970x250"] or tuple array like [[728, 90]]
      const parsed: number[][] = rawSizes.map((s: unknown) => {
        if (typeof s === "string") {
          return s.split("x").map(Number);
        }
        if (Array.isArray(s)) {
          return s as number[];
        }
        return [0, 0];
      });

      // Assign to desktop/mobile based on device targeting
      if (device === "mobile") {
        sizes = { desktop: [], mobile: parsed };
      } else if (device === "desktop") {
        sizes = { desktop: parsed, mobile: [] };
      } else {
        // "all" — put all sizes in both buckets
        sizes = { desktop: parsed, mobile: parsed };
      }
    } else {
      sizes = { desktop: [], mobile: [] };
    }

    return { id, position, sizes, device };
  });
}

// ---------------------------------------------------------------------------
// Theme resolution
// ---------------------------------------------------------------------------

function resolveTheme(
  orgDefaults: { default_theme?: string; default_fonts?: { heading: string; body: string } },
  groupThemes: (Partial<ThemeConfig> | undefined)[],
  siteTheme: Partial<ThemeConfig> | undefined,
): ResolvedThemeConfig {
  const base: ResolvedThemeConfig = {
    base: (orgDefaults.default_theme as "modern" | "editorial") ?? "modern",
    colors: {},
    logo: "",
    favicon: "",
    fonts: {
      heading: orgDefaults.default_fonts?.heading ?? "sans-serif",
      body: orgDefaults.default_fonts?.body ?? "sans-serif",
    },
  };

  function applyTheme(t: Partial<ThemeConfig>): void {
    if (t.base) base.base = t.base;
    if (t.colors) base.colors = { ...base.colors, ...t.colors };
    if (t.logo) base.logo = t.logo;
    if (t.favicon) base.favicon = t.favicon;
    if (t.fonts) {
      if (t.fonts.heading) base.fonts.heading = t.fonts.heading;
      if (t.fonts.body) base.fonts.body = t.fonts.body;
    }
  }

  // Apply each group's theme in order (left to right)
  for (const gt of groupThemes) {
    if (gt) applyTheme(gt);
  }

  // Site theme wins
  if (siteTheme) applyTheme(siteTheme);

  return base;
}

// ---------------------------------------------------------------------------
// ads_txt collection
// ---------------------------------------------------------------------------

function parseAdsTxt(raw: unknown): string[] {
  if (typeof raw === "string") {
    return raw.split("\n").map((l: string) => l.trim()).filter((l: string) => l.length > 0);
  }
  if (Array.isArray(raw)) {
    return (raw as unknown[]).filter((x): x is string => typeof x === "string");
  }
  return [];
}

function collectAdsTxt(raw: Record<string, unknown> | null | undefined): string[] {
  if (!raw) return [];
  const entries: string[] = [];
  // Top-level ads_txt (new style)
  entries.push(...parseAdsTxt(raw["ads_txt"]));
  // Nested inside ads_config (legacy — still supported)
  const adsCfg = raw["ads_config"] as Record<string, unknown> | undefined;
  if (adsCfg) {
    entries.push(...parseAdsTxt(adsCfg["ads_txt"]));
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Override loading
// ---------------------------------------------------------------------------

/**
 * Load all override config files from overrides/config/*.yaml.
 */
async function loadOverrides(
  networkRepoPath: string,
): Promise<OverrideConfig[]> {
  const overridesDir = join(networkRepoPath, "overrides", "config");
  let files: string[];
  try {
    files = await readdir(overridesDir);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  const overrides: OverrideConfig[] = [];
  for (const file of files) {
    if (!file.endsWith(".yaml")) continue;
    const raw = await readYaml<OverrideConfig>(join(overridesDir, file));
    overrides.push(raw);
  }
  return overrides;
}

/**
 * Check if a site is targeted by an override.
 */
function isOverrideTargetingSite(
  override: OverrideConfig,
  siteDomain: string,
  siteGroups: string[],
): boolean {
  const targetSites = override.targets?.sites ?? [];
  const targetGroups = override.targets?.groups ?? [];

  // Direct site targeting
  if (targetSites.includes(siteDomain)) return true;

  // Group targeting — site is in a targeted group
  for (const g of siteGroups) {
    if (targetGroups.includes(g)) return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Smart merge mode helpers
// ---------------------------------------------------------------------------

/**
 * Extract `_mode` from a field value object, stripping it from the data.
 * Returns the mode and a clean copy of the data without _mode.
 */
function extractMode<M extends string>(
  value: Record<string, unknown>,
  defaultMode: M,
): { mode: M; clean: Record<string, unknown> } {
  const { _mode, ...clean } = value;
  return { mode: (_mode as M) ?? defaultMode, clean };
}

/**
 * Merge tracking: deep-merge override keys into the current tracking.
 * Only specified keys change; unset keys inherit from parent.
 */
function mergeTracking(
  current: TrackingConfig,
  overrideData: Record<string, unknown>,
): TrackingConfig {
  const result = { ...current };
  for (const [key, value] of Object.entries(overrideData)) {
    (result as unknown as Record<string, unknown>)[key] = value;
  }
  return result;
}

/**
 * Append scripts from the override without replacing any existing scripts.
 * New entries are added at the end of each position's array.
 */
function appendScripts(
  current: ScriptsConfig,
  overrideScripts: Partial<ScriptsConfig>,
): ScriptsConfig {
  return {
    head: [
      ...current.head,
      ...(overrideScripts.head
        ? normaliseScriptArray(overrideScripts.head as unknown as unknown[])
            .filter((entry) => !current.head.some((e) => e.id === entry.id))
        : []),
    ],
    body_start: [
      ...current.body_start,
      ...(overrideScripts.body_start
        ? normaliseScriptArray(overrideScripts.body_start as unknown as unknown[])
            .filter((entry) => !current.body_start.some((e) => e.id === entry.id))
        : []),
    ],
    body_end: [
      ...current.body_end,
      ...(overrideScripts.body_end
        ? normaliseScriptArray(overrideScripts.body_end as unknown as unknown[])
            .filter((entry) => !current.body_end.some((e) => e.id === entry.id))
        : []),
    ],
  };
}

/**
 * Merge ad placements by id: existing placements are kept, matching ids are
 * replaced, new ids are appended.
 */
function mergeAdPlacementsById(
  current: AdPlacement[],
  overridePlacements: unknown[],
): AdPlacement[] {
  const normalised = normaliseAdPlacements(overridePlacements);
  const merged = new Map<string, AdPlacement>();
  for (const p of current) merged.set(p.id, p);
  for (const p of normalised) merged.set(p.id, p);
  return Array.from(merged.values());
}

/**
 * Apply override fields with per-field merge mode control.
 *
 * Each field checks its `_mode` directive (falling back to a safe default):
 *   tracking     → merge (default)
 *   scripts      → merge_by_id (default)
 *   scripts_vars → merge (default)
 *   ads_config   → replace (default)
 *   ads_txt      → add (default)
 *   theme        → merge (default)
 *   legal        → merge (default)
 */
function applyOverride(
  tracking: TrackingConfig,
  scripts: ScriptsConfig,
  adsConfig: AdsConfig,
  adsTxt: string[],
  scriptsVars: Record<string, string>,
  theme: Record<string, unknown> | undefined,
  legal: Record<string, string>,
  override: OverrideConfig,
): {
  tracking: TrackingConfig;
  scripts: ScriptsConfig;
  adsConfig: AdsConfig;
  adsTxt: string[];
  scriptsVars: Record<string, string>;
  theme: Record<string, unknown> | undefined;
  legal: Record<string, string>;
} {
  let newTracking = tracking;
  let newScripts = scripts;
  let newAdsConfig = adsConfig;
  let newAdsTxt = adsTxt;
  let newScriptsVars = scriptsVars;
  let newTheme = theme;
  let newLegal = legal;

  // ---- Tracking ----
  if (override.tracking) {
    const { mode, clean } = extractMode<SimpleMergeMode>(
      override.tracking as unknown as Record<string, unknown>,
      "merge",
    );
    if (mode === "replace") {
      // Wipe and use only override values
      newTracking = {
        ga4: null,
        gtm: null,
        google_ads: null,
        facebook_pixel: null,
        custom: [],
        ...clean,
      } as unknown as TrackingConfig;
    } else {
      // merge: deep-merge override keys into current tracking
      newTracking = mergeTracking(newTracking, clean);
    }
  }

  // ---- Scripts ----
  if (override.scripts) {
    // Accept legacy "append" from existing YAML data even though UI no longer offers it
    const { mode, clean } = extractMode<ScriptsMergeMode | "append">(
      override.scripts as unknown as Record<string, unknown>,
      "merge_by_id",
    );
    const overrideScripts = clean as unknown as Partial<ScriptsConfig>;

    if (mode === "replace") {
      // Wipe and use only override scripts
      newScripts = {
        head: overrideScripts.head
          ? normaliseScriptArray(overrideScripts.head as unknown as unknown[])
          : [],
        body_start: overrideScripts.body_start
          ? normaliseScriptArray(overrideScripts.body_start as unknown as unknown[])
          : [],
        body_end: overrideScripts.body_end
          ? normaliseScriptArray(overrideScripts.body_end as unknown as unknown[])
          : [],
      };
    } else if (mode === "append") {
      // Add new scripts without replacing existing ones
      newScripts = appendScripts(newScripts, overrideScripts);
    } else {
      // merge_by_id: merge by script id (same id = replace, new id = append)
      newScripts = mergeScriptsConfigs(newScripts, {
        head: overrideScripts.head
          ? normaliseScriptArray(overrideScripts.head as unknown as unknown[])
          : undefined,
        body_start: overrideScripts.body_start
          ? normaliseScriptArray(overrideScripts.body_start as unknown as unknown[])
          : undefined,
        body_end: overrideScripts.body_end
          ? normaliseScriptArray(overrideScripts.body_end as unknown as unknown[])
          : undefined,
      });
    }
  }

  // ---- Ads Config ----
  if (override.ads_config) {
    const { mode, clean } = extractMode<AdsConfigMergeMode>(
      override.ads_config as unknown as Record<string, unknown>,
      "replace",
    );
    const overrideAds = clean as Record<string, unknown>;

    if (mode === "add") {
      // Append new placements without touching existing ones
      const rawPlacements = overrideAds["ad_placements"];
      if (rawPlacements && Array.isArray(rawPlacements) && rawPlacements.length > 0) {
        newAdsConfig = {
          ...newAdsConfig,
          ...(overrideAds["interstitial"] !== undefined ? { interstitial: overrideAds["interstitial"] as boolean } : {}),
          ...(overrideAds["layout"] !== undefined ? { layout: overrideAds["layout"] as string } : {}),
          ad_placements: [
            ...newAdsConfig.ad_placements,
            ...normaliseAdPlacements(rawPlacements as unknown[]),
          ],
        };
      }
    } else if (mode === "merge_placements") {
      // Keep existing config, merge placements by id
      const rawPlacements = overrideAds["ad_placements"];
      if (rawPlacements && Array.isArray(rawPlacements) && rawPlacements.length > 0) {
        newAdsConfig = {
          ...newAdsConfig,
          ...(overrideAds["interstitial"] !== undefined ? { interstitial: overrideAds["interstitial"] as boolean } : {}),
          ...(overrideAds["layout"] !== undefined ? { layout: overrideAds["layout"] as string } : {}),
          ad_placements: mergeAdPlacementsById(
            newAdsConfig.ad_placements,
            rawPlacements as unknown[],
          ),
        };
      } else {
        // No placements to merge, just merge other fields
        if (overrideAds["interstitial"] !== undefined) {
          newAdsConfig = { ...newAdsConfig, interstitial: overrideAds["interstitial"] as boolean };
        }
        if (overrideAds["layout"] !== undefined) {
          newAdsConfig = { ...newAdsConfig, layout: overrideAds["layout"] as string };
        }
      }
    } else {
      // replace: wipe and use only override ads_config
      const rawPlacements = overrideAds["ad_placements"];
      newAdsConfig = {
        interstitial: (overrideAds["interstitial"] as boolean | undefined) ?? false,
        layout: (overrideAds["layout"] as string | undefined) ?? "standard",
        ad_placements: rawPlacements && Array.isArray(rawPlacements)
          ? normaliseAdPlacements(rawPlacements as unknown[])
          : [],
      };
    }
  }

  // ---- Ads.txt ----
  if (override.ads_txt !== undefined) {
    let mode: AdsTxtMergeMode = "add";
    let entries: string[] = [];

    if (Array.isArray(override.ads_txt)) {
      // Plain array — use default mode (add)
      entries = override.ads_txt;
    } else if (
      override.ads_txt &&
      typeof override.ads_txt === "object" &&
      "_mode" in override.ads_txt
    ) {
      // Object with _mode and _values
      mode = (override.ads_txt as { _mode: AdsTxtMergeMode })._mode;
      entries = (override.ads_txt as { _values: string[] })._values ?? [];
    }

    if (mode === "replace") {
      newAdsTxt = [...entries];
    } else {
      // add: append entries to existing, dedupe
      newAdsTxt = [...new Set([...newAdsTxt, ...entries])];
    }
  }

  // ---- Scripts Vars ----
  if (override.scripts_vars) {
    const { mode, clean } = extractMode<SimpleMergeMode>(
      override.scripts_vars as unknown as Record<string, unknown>,
      "merge",
    );
    if (mode === "replace") {
      newScriptsVars = clean as unknown as Record<string, string>;
    } else {
      // merge: add/overwrite keys
      newScriptsVars = { ...newScriptsVars, ...clean as unknown as Record<string, string> };
    }
  }

  // ---- Theme ----
  if (override.theme) {
    const { mode, clean } = extractMode<SimpleMergeMode>(
      override.theme as unknown as Record<string, unknown>,
      "merge",
    );
    if (mode === "replace") {
      newTheme = clean;
    } else {
      // merge: deep-merge
      newTheme = newTheme
        ? deepMerge(newTheme as Record<string, unknown>, clean)
        : clean;
    }
  }

  // ---- Legal ----
  if (override.legal) {
    const { mode, clean } = extractMode<SimpleMergeMode>(
      override.legal as unknown as Record<string, unknown>,
      "merge",
    );
    if (mode === "replace") {
      newLegal = clean as unknown as Record<string, string>;
    } else {
      newLegal = { ...newLegal, ...clean as unknown as Record<string, string> };
    }
  }

  return {
    tracking: newTracking,
    scripts: newScripts,
    adsConfig: newAdsConfig,
    adsTxt: newAdsTxt,
    scriptsVars: newScriptsVars,
    theme: newTheme,
    legal: newLegal,
  };
}

// ---------------------------------------------------------------------------
// Main resolver
// ---------------------------------------------------------------------------

/**
 * Resolve a site's full configuration by reading YAML files from the network
 * data repository and deep-merging them:
 *
 *   org → groups[0..N] → overrides (by priority, REPLACE) → site
 *
 * @param networkRepoPath - Absolute path to the network data repository root.
 * @param siteDomain - Domain name of the site to resolve (e.g. "coolnews.dev").
 * @returns Fully resolved configuration with all placeholders replaced.
 */
export async function resolveConfig(
  networkRepoPath: string,
  siteDomain: string,
): Promise<ResolvedConfig> {
  // ---- 1. Read core config files ----

  const networkPath = join(networkRepoPath, "network.yaml");
  const orgPath = join(networkRepoPath, "org.yaml");
  const sitePath = join(networkRepoPath, "sites", siteDomain, "site.yaml");

  const network = await readYaml<NetworkManifest>(networkPath);
  const orgRaw = await readYaml<Record<string, unknown>>(orgPath);
  const siteRaw = await readYaml<Record<string, unknown>>(sitePath);

  // Validate required network fields
  if (!network.platform_version) {
    throw new Error("network.yaml is missing required field: platform_version");
  }
  if (!network.network_id) {
    throw new Error("network.yaml is missing required field: network_id");
  }

  const org = orgRaw as unknown as OrgConfig;
  const site = siteRaw as unknown as SiteConfig;

  if (!site.domain) {
    throw new Error(`site.yaml for ${siteDomain} is missing required field: domain`);
  }

  // ---- 2. Resolve groups array ----
  //
  // Priority: site.groups > site.group (legacy) > org.default_groups > org.default_monetization (legacy)
  // If site.monetization exists, append it to the groups array (backward compat).

  let siteGroups: string[];
  if (Array.isArray(siteRaw["groups"]) && (siteRaw["groups"] as string[]).length > 0) {
    siteGroups = siteRaw["groups"] as string[];
  } else if (typeof siteRaw["group"] === "string" && (siteRaw["group"] as string).length > 0) {
    siteGroups = [siteRaw["group"] as string];
  } else if (Array.isArray(orgRaw["default_groups"]) && (orgRaw["default_groups"] as string[]).length > 0) {
    siteGroups = orgRaw["default_groups"] as string[];
  } else if (typeof orgRaw["default_monetization"] === "string" && (orgRaw["default_monetization"] as string).length > 0) {
    // Legacy: org.default_monetization treated as a default group
    siteGroups = [orgRaw["default_monetization"] as string];
  } else {
    siteGroups = [];
  }

  // Legacy: if site has monetization: field, append it to groups (backward compat)
  if (typeof siteRaw["monetization"] === "string" && (siteRaw["monetization"] as string).length > 0) {
    const monId = siteRaw["monetization"] as string;
    if (!siteGroups.includes(monId)) {
      siteGroups.push(monId);
    }
  }

  // ---- 3. Read groups (left-to-right merge) ----

  const groupRaws: Record<string, unknown>[] = [];
  for (const groupId of siteGroups) {
    const groupPath = join(networkRepoPath, "groups", `${groupId}.yaml`);
    let raw = await readYamlOptional<Record<string, unknown>>(groupPath);

    // Backward compat: if group file not found, try monetization/ directory
    if (!raw) {
      const monetizationPath = join(networkRepoPath, "monetization", `${groupId}.yaml`);
      raw = await readYamlOptional<Record<string, unknown>>(monetizationPath);
    }

    if (!raw) {
      throw new Error(
        `Group "${groupId}" not found for site "${siteDomain}". Looked for groups/${groupId}.yaml`,
      );
    }
    groupRaws.push(raw);
  }

  // ---- 4. Merge tracking: org → groups (left to right) ----

  let tracking: TrackingConfig = { ...org.tracking };
  for (const gRaw of groupRaws) {
    const gTracking = gRaw["tracking"] as Partial<TrackingConfig> | undefined;
    if (gTracking) {
      tracking = deepMerge(
        tracking as unknown as Record<string, unknown>,
        gTracking as unknown as Record<string, unknown>,
      ) as unknown as TrackingConfig;
    }
  }

  // ---- 5. Merge scripts by id: org → each group ----

  const orgScripts: ScriptsConfig = orgRaw["scripts"]
    ? normaliseScriptsConfig(orgRaw["scripts"] as Record<string, unknown>)
    : { head: [], body_start: [], body_end: [] };

  let mergedScripts: ScriptsConfig = orgScripts;

  for (const gRaw of groupRaws) {
    if (gRaw["scripts"]) {
      const groupScripts = normaliseScriptsConfig(
        gRaw["scripts"] as Record<string, unknown>,
      );
      mergedScripts = mergeScriptsConfigs(mergedScripts, groupScripts);
    }
  }

  // ---- 6. Merge ads_config: org → groups ----

  let adsConfig: AdsConfig = { ...org.ads_config };
  for (const gRaw of groupRaws) {
    const gAds = gRaw["ads_config"] as Partial<AdsConfig> | undefined;
    if (gAds) {
      adsConfig = deepMerge(
        adsConfig as unknown as Record<string, unknown>,
        gAds as unknown as Record<string, unknown>,
      ) as unknown as AdsConfig;
    }
  }

  // Ad placements: full replacement (no merge). The latest layer that
  // defines ad_placements wins (last group with placements wins).
  let lastPlacementSource: unknown[] | undefined;
  for (const gRaw of groupRaws) {
    const gAds = gRaw["ads_config"] as Record<string, unknown> | undefined;
    if (gAds?.["ad_placements"] && Array.isArray(gAds["ad_placements"]) && (gAds["ad_placements"] as unknown[]).length > 0) {
      lastPlacementSource = gAds["ad_placements"] as unknown[];
    }
  }
  if (!lastPlacementSource) {
    // Fall back to org placements
    lastPlacementSource = org.ads_config?.ad_placements as unknown[] | undefined;
  }
  if (lastPlacementSource && lastPlacementSource.length > 0) {
    adsConfig = { ...adsConfig, ad_placements: normaliseAdPlacements(lastPlacementSource) };
  }

  // ---- 7. Merge ads_txt: APPEND from org + all groups, dedupe ----

  const adsTxtEntries: string[] = [];
  adsTxtEntries.push(...collectAdsTxt(orgRaw));
  for (const gRaw of groupRaws) {
    adsTxtEntries.push(...collectAdsTxt(gRaw));
  }

  // ---- 8. Load and apply overrides (per-field merge modes) ----

  const allOverrides = await loadOverrides(networkRepoPath);
  const matchingOverrides = allOverrides
    .filter((o) => isOverrideTargetingSite(o, siteDomain, siteGroups))
    .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));

  const appliedOverrideIds: string[] = [];
  let currentAdsTxt = [...new Set(adsTxtEntries)];

  // Collect override-level vars and theme/legal for the new applyOverride signature
  let overrideVarsAccum: Record<string, string> = {};
  let overrideTheme: Record<string, unknown> | undefined;

  // Merge group themes into a single object for override to build on
  for (const gRaw of groupRaws) {
    const gt = (gRaw as Record<string, unknown>)["theme"] as Record<string, unknown> | undefined;
    if (gt) {
      overrideTheme = overrideTheme
        ? deepMerge(overrideTheme, gt)
        : { ...gt };
    }
  }

  // Accumulate legal from groups for override
  let overrideLegal: Record<string, string> = { ...(org.legal ?? {}) };
  for (const gRaw of groupRaws) {
    const g = gRaw as unknown as GroupConfig;
    if (g.legal_pages_override) {
      overrideLegal = { ...overrideLegal, ...g.legal_pages_override };
    }
  }

  for (const override of matchingOverrides) {
    const result = applyOverride(
      tracking,
      mergedScripts,
      adsConfig,
      currentAdsTxt,
      overrideVarsAccum,
      overrideTheme,
      overrideLegal,
      override,
    );
    tracking = result.tracking;
    mergedScripts = result.scripts;
    adsConfig = result.adsConfig;
    currentAdsTxt = result.adsTxt;
    overrideVarsAccum = result.scriptsVars;
    overrideTheme = result.theme;
    overrideLegal = result.legal;
    appliedOverrideIds.push(override.override_id);
  }

  // ---- 9. Apply site-level overrides (standard merge, site wins) ----

  if (site.tracking) {
    tracking = deepMerge(
      tracking as unknown as Record<string, unknown>,
      site.tracking as unknown as Record<string, unknown>,
    ) as unknown as TrackingConfig;
  }

  // Site ad_placements: if site defines them, they win
  if (site.ads_config) {
    adsConfig = deepMerge(
      adsConfig as unknown as Record<string, unknown>,
      site.ads_config as unknown as Record<string, unknown>,
    ) as unknown as AdsConfig;

    if (site.ads_config.ad_placements && (site.ads_config.ad_placements as unknown[]).length > 0) {
      adsConfig = {
        ...adsConfig,
        ad_placements: normaliseAdPlacements(site.ads_config.ad_placements as unknown as unknown[]),
      };
    }
  }

  // Site ads_txt (additive with existing)
  currentAdsTxt.push(...collectAdsTxt(siteRaw));
  const adsTxt = [...new Set(currentAdsTxt)];

  // ---- 10. Merge scripts_vars from all levels, then resolve placeholders ----

  const orgVars = (orgRaw["scripts_vars"] as Record<string, string>) ?? {};
  let groupVars: Record<string, string> = {};
  for (const gRaw of groupRaws) {
    const gVars = (gRaw["scripts_vars"] as Record<string, string>) ?? {};
    groupVars = { ...groupVars, ...gVars };
  }
  // overrideVarsAccum was accumulated during override application (respects _mode)
  const siteVars = (site.scripts_vars as Record<string, string>) ?? {};

  const allVars: Record<string, string> = {
    ...orgVars,
    ...groupVars,
    ...overrideVarsAccum,
    ...siteVars,
    domain: siteDomain,
  };

  mergedScripts = resolveTemplates(mergedScripts, allVars) as ScriptsConfig;

  const unresolvedCheck = JSON.stringify(mergedScripts);
  const remaining = unresolvedCheck.match(/\{\{(\w+)\}\}/g);
  if (remaining && remaining.length > 0) {
    const unique = [...new Set(remaining)];
    throw new Error(
      `Unresolved placeholders in scripts: ${unique.join(", ")}. ` +
      `Define these in scripts_vars at org, group, override, or site level.`,
    );
  }

  // ---- 11. Merge theme: org defaults → each group → override (with _mode) → site ----

  const groupThemes = groupRaws.map((g) => (g as Record<string, unknown>)["theme"] as Partial<ThemeConfig> | undefined);

  // Override themes were already merged during applyOverride with _mode support.
  // Pass the accumulated override theme as a single entry.
  const allThemes = [...groupThemes, overrideTheme as Partial<ThemeConfig> | undefined];
  const theme = resolveTheme(org, allThemes, site.theme);

  // ---- 12. Merge legal: org → groups → overrides (with _mode) → site ----

  // overrideLegal was accumulated during applyOverride with _mode support.
  // Apply legacy legal_pages_override from overrides (not affected by _mode).
  let legal = { ...overrideLegal };
  for (const override of matchingOverrides) {
    if (override.legal_pages_override) legal = { ...legal, ...override.legal_pages_override };
  }
  if (site.legal) {
    legal = { ...legal, ...site.legal };
  }

  // ---- 13. Resolve support email ----

  const supportEmail = resolveString(
    org.support_email_pattern ?? "",
    { domain: siteDomain },
  );

  // ---- 14. Merge feature configs: org → groups → site with defaults ----

  const mergedGroup = groupRaws.length > 0
    ? groupRaws.reduce((acc, g) => deepMerge(acc, g)) as unknown as GroupConfig
    : {} as Partial<GroupConfig>;

  const previewPageDefaults: PreviewPageConfig = {
    enabled: false,
    excerpt_paragraphs: 3,
    cta_text: "Continue Reading",
    show_ads: true,
  };
  const previewPage: PreviewPageConfig = {
    ...previewPageDefaults,
    ...(org.preview_page ?? {}),
    ...((mergedGroup as GroupConfig).preview_page ?? {}),
    ...(site.preview_page ?? {}),
  };

  const categoriesDefaults: CategoryConfig = {
    enabled: true,
    per_page: 12,
  };
  const categories: CategoryConfig = {
    ...categoriesDefaults,
    ...(org.categories ?? {}),
    ...((mergedGroup as GroupConfig).categories ?? {}),
    ...(site.categories ?? {}),
  };

  const sidebarDefaults: SidebarConfig = {
    enabled: false,
    widgets: [],
  };
  const sidebarMerged: SidebarConfig = {
    ...sidebarDefaults,
    ...(org.sidebar ?? {}),
    ...((mergedGroup as GroupConfig).sidebar ?? {}),
    ...(site.sidebar ?? {}),
  };

  const searchDefaults: SearchConfig = {
    enabled: false,
  };
  const search: SearchConfig = {
    ...searchDefaults,
    ...(org.search ?? {}),
    ...((mergedGroup as GroupConfig).search ?? {}),
    ...(site.search ?? {}),
  };

  // ---- 15. Placeholder heights ----

  const adPlaceholderHeights: AdPlaceholderHeights = {
    ...DEFAULT_AD_PLACEHOLDER_HEIGHTS,
    ...(org.ad_placeholder_heights ?? {}),
  };

  // ---- 16. Build inline ad config JSON for runtime ad-loader ----

  const inlineAdConfig: InlineAdConfig = {
    domain: site.domain,
    groups: siteGroups,
    applied_overrides: appliedOverrideIds,
    tracking,
    scripts: mergedScripts,
    ads_config: adsConfig,
    generated_at: new Date().toISOString(),
  };

  // ---- 17. Assemble ResolvedConfig ----

  const resolved: ResolvedConfig = {
    network_id: network.network_id,
    platform_version: network.platform_version,
    organization: org.organization,
    legal_entity: org.legal_entity,
    company_address: org.company_address,
    domain: site.domain,
    site_name: site.site_name,
    site_tagline: site.site_tagline ?? null,
    group: siteGroups[0] ?? "",
    groups: siteGroups,
    applied_overrides: appliedOverrideIds,
    support_email: supportEmail,
    active: site.active,
    tracking,
    scripts: mergedScripts,
    ads_txt: adsTxt,
    ads_config: adsConfig,
    theme,
    brief: site.brief,
    legal,
    ad_placeholder_heights: adPlaceholderHeights,
    preview_page: previewPage,
    categories,
    sidebar: sidebarMerged,
    search,
    inlineAdConfig,
  };

  return resolved;
}
