/**
 * Config Resolver for the Atomic Content Network Platform.
 *
 * Reads YAML config files from a network data repo, deep-merges them
 * following the inheritance chain (org -> monetization -> group -> site),
 * resolves all {{placeholder}} variables, and returns a fully-typed
 * ResolvedConfig.
 *
 * The monetization layer is new: sites reference `monetization/<id>.yaml`
 * either explicitly via `monetization:` in site.yaml or via
 * `org.default_monetization`. When neither is set, the monetization layer
 * is skipped (for backward compatibility with older networks).
 */

import { readFile } from "node:fs/promises";
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
  MonetizationConfig,
  AdPlaceholderHeights,
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
  groupTheme: Partial<ThemeConfig> | undefined,
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

  // Merge group theme
  if (groupTheme) {
    if (groupTheme.base) base.base = groupTheme.base;
    if (groupTheme.colors) base.colors = { ...base.colors, ...groupTheme.colors };
    if (groupTheme.logo) base.logo = groupTheme.logo;
    if (groupTheme.favicon) base.favicon = groupTheme.favicon;
    if (groupTheme.fonts) {
      if (groupTheme.fonts.heading) base.fonts.heading = groupTheme.fonts.heading;
      if (groupTheme.fonts.body) base.fonts.body = groupTheme.fonts.body;
    }
  }

  // Merge site theme
  if (siteTheme) {
    if (siteTheme.base) base.base = siteTheme.base;
    if (siteTheme.colors) base.colors = { ...base.colors, ...siteTheme.colors };
    if (siteTheme.logo) base.logo = siteTheme.logo;
    if (siteTheme.favicon) base.favicon = siteTheme.favicon;
    if (siteTheme.fonts) {
      if (siteTheme.fonts.heading) base.fonts.heading = siteTheme.fonts.heading;
      if (siteTheme.fonts.body) base.fonts.body = siteTheme.fonts.body;
    }
  }

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
// Main resolver
// ---------------------------------------------------------------------------

/**
 * Resolve a site's full configuration by reading YAML files from the network
 * data repository and deep-merging them: org -> monetization -> group -> site.
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

  // Normalize groups: support both `groups: [...]` (new) and `group: string` (legacy)
  const siteGroups: string[] = site.groups
    ?? (site.group ? [site.group] : []);
  if (siteGroups.length === 0) {
    throw new Error(`site.yaml for ${siteDomain} has neither "group" nor "groups"`);
  }

  // ---- 2. Resolve monetization profile ----
  //
  // Precedence: site.monetization -> org.default_monetization -> none.
  // When an id is specified, the corresponding file MUST exist (error if not).

  const monetizationId =
    (typeof siteRaw["monetization"] === "string" ? (siteRaw["monetization"] as string) : undefined)
    ?? (typeof orgRaw["default_monetization"] === "string" ? (orgRaw["default_monetization"] as string) : undefined)
    ?? "";

  let monetizationRaw: Record<string, unknown> | null = null;
  if (monetizationId) {
    const monetizationPath = join(networkRepoPath, "monetization", `${monetizationId}.yaml`);
    monetizationRaw = await readYamlOptional<Record<string, unknown>>(monetizationPath);
    if (!monetizationRaw) {
      throw new Error(
        `Monetization profile "${monetizationId}" not found. Expected file at monetization/${monetizationId}.yaml`,
      );
    }
  }
  const monetization = (monetizationRaw ?? {}) as Partial<MonetizationConfig> & Record<string, unknown>;

  // ---- 3. Read groups (left-to-right merge) ----

  const groupRaws: Record<string, unknown>[] = [];
  for (const groupId of siteGroups) {
    const groupPath = join(networkRepoPath, "groups", `${groupId}.yaml`);
    let raw: Record<string, unknown>;
    try {
      raw = await readYaml<Record<string, unknown>>(groupPath);
    } catch (err: unknown) {
      if (err instanceof Error && err.message.startsWith("Config file not found")) {
        throw new Error(
          `Site "${siteDomain}" references group "${groupId}", but group file not found: ${groupPath}`,
        );
      }
      throw err;
    }
    groupRaws.push(raw);
  }

  // Merge multiple groups into one effective group (left-to-right: later groups override earlier)
  let mergedGroupRaw: Record<string, unknown> = groupRaws[0];
  for (let i = 1; i < groupRaws.length; i++) {
    mergedGroupRaw = deepMerge(mergedGroupRaw, groupRaws[i]);
  }
  const group = mergedGroupRaw as unknown as GroupConfig;

  // ---- 4. Merge tracking: org -> monetization -> group -> site ----

  let tracking: TrackingConfig = { ...org.tracking };
  if (monetization.tracking) {
    tracking = deepMerge(
      tracking as unknown as Record<string, unknown>,
      monetization.tracking as unknown as Record<string, unknown>,
    ) as unknown as TrackingConfig;
  }
  if (group.tracking) {
    tracking = deepMerge(
      tracking as unknown as Record<string, unknown>,
      group.tracking as unknown as Record<string, unknown>,
    ) as unknown as TrackingConfig;
  }
  if (site.tracking) {
    tracking = deepMerge(
      tracking as unknown as Record<string, unknown>,
      site.tracking as unknown as Record<string, unknown>,
    ) as unknown as TrackingConfig;
  }

  // ---- 5. Merge scripts by id: org -> monetization -> each group ----

  const orgScripts: ScriptsConfig = orgRaw["scripts"]
    ? normaliseScriptsConfig(orgRaw["scripts"] as Record<string, unknown>)
    : { head: [], body_start: [], body_end: [] };

  let mergedScripts: ScriptsConfig = orgScripts;

  if (monetizationRaw && monetizationRaw["scripts"]) {
    const monScripts = normaliseScriptsConfig(
      monetizationRaw["scripts"] as Record<string, unknown>,
    );
    mergedScripts = mergeScriptsConfigs(mergedScripts, monScripts);
  }

  for (const gRaw of groupRaws) {
    if (gRaw["scripts"]) {
      const groupScripts = normaliseScriptsConfig(
        gRaw["scripts"] as Record<string, unknown>,
      );
      mergedScripts = mergeScriptsConfigs(mergedScripts, groupScripts);
    }
  }

  // ---- 6. Merge scripts_vars from all levels, then resolve placeholders ----

  const orgVars = (orgRaw["scripts_vars"] as Record<string, string>) ?? {};
  const monetizationVars =
    (monetizationRaw?.["scripts_vars"] as Record<string, string> | undefined) ?? {};
  let groupVars: Record<string, string> = {};
  for (const gRaw of groupRaws) {
    const gVars = (gRaw["scripts_vars"] as Record<string, string>) ?? {};
    groupVars = { ...groupVars, ...gVars };
  }
  const siteVars = (site.scripts_vars as Record<string, string>) ?? {};

  const allVars: Record<string, string> = {
    ...orgVars,
    ...monetizationVars,
    ...groupVars,
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
      `Define these in scripts_vars at org, monetization, group, or site level.`,
    );
  }

  // ---- 7. Merge ads_config: org -> monetization -> group -> site ----

  let adsConfig: AdsConfig = { ...org.ads_config };
  if (monetization.ads_config) {
    adsConfig = deepMerge(
      adsConfig as unknown as Record<string, unknown>,
      monetization.ads_config as unknown as Record<string, unknown>,
    ) as unknown as AdsConfig;
  }
  if (group.ads_config) {
    adsConfig = deepMerge(
      adsConfig as unknown as Record<string, unknown>,
      group.ads_config as unknown as Record<string, unknown>,
    ) as unknown as AdsConfig;
  }
  if (site.ads_config) {
    adsConfig = deepMerge(
      adsConfig as unknown as Record<string, unknown>,
      site.ads_config as unknown as Record<string, unknown>,
    ) as unknown as AdsConfig;
  }

  // Ad placements: full replacement (no merge). The latest layer that
  // defines ad_placements wins. Precedence: site > group > monetization > org.
  const placementSources: unknown[] | undefined =
    (site.ads_config?.ad_placements as unknown[] | undefined)
    ?? (group.ads_config?.ad_placements as unknown[] | undefined)
    ?? (monetization.ads_config?.ad_placements as unknown[] | undefined)
    ?? (org.ads_config?.ad_placements as unknown[] | undefined);

  if (placementSources && placementSources.length > 0) {
    adsConfig = { ...adsConfig, ad_placements: normaliseAdPlacements(placementSources) };
  }

  // ---- 8. Merge ads_txt: APPEND from all 4 layers, dedupe ----

  const adsTxtEntries: string[] = [];
  adsTxtEntries.push(...collectAdsTxt(orgRaw));
  adsTxtEntries.push(...collectAdsTxt(monetizationRaw));
  for (const gRaw of groupRaws) {
    adsTxtEntries.push(...collectAdsTxt(gRaw));
  }
  adsTxtEntries.push(...collectAdsTxt(siteRaw));
  const adsTxt = [...new Set(adsTxtEntries)];

  // ---- 9. Merge theme: org defaults -> group -> site ----

  const theme = resolveTheme(org, group.theme, site.theme);

  // ---- 10. Merge legal: org -> group -> site ----

  let legal: Record<string, string> = { ...(org.legal ?? {}) };
  if (group.legal_pages_override) {
    legal = { ...legal, ...group.legal_pages_override };
  }
  if (site.legal) {
    legal = { ...legal, ...site.legal };
  }

  // ---- 11. Resolve support email ----

  const supportEmail = resolveString(
    org.support_email_pattern ?? "",
    { domain: siteDomain },
  );

  // ---- 12. Merge feature configs: org -> group -> site with defaults ----

  const previewPageDefaults: PreviewPageConfig = {
    enabled: false,
    excerpt_paragraphs: 3,
    cta_text: "Continue Reading",
    show_ads: true,
  };
  const previewPage: PreviewPageConfig = {
    ...previewPageDefaults,
    ...(org.preview_page ?? {}),
    ...(group.preview_page ?? {}),
    ...(site.preview_page ?? {}),
  };

  const categoriesDefaults: CategoryConfig = {
    enabled: true,
    per_page: 12,
  };
  const categories: CategoryConfig = {
    ...categoriesDefaults,
    ...(org.categories ?? {}),
    ...(group.categories ?? {}),
    ...(site.categories ?? {}),
  };

  const sidebarDefaults: SidebarConfig = {
    enabled: false,
    widgets: [],
  };
  const sidebarMerged: SidebarConfig = {
    ...sidebarDefaults,
    ...(org.sidebar ?? {}),
    ...(group.sidebar ?? {}),
    ...(site.sidebar ?? {}),
  };

  const searchDefaults: SearchConfig = {
    enabled: false,
  };
  const search: SearchConfig = {
    ...searchDefaults,
    ...(org.search ?? {}),
    ...(group.search ?? {}),
    ...(site.search ?? {}),
  };

  // ---- 13. Placeholder heights ----

  const adPlaceholderHeights: AdPlaceholderHeights = {
    ...DEFAULT_AD_PLACEHOLDER_HEIGHTS,
    ...(org.ad_placeholder_heights ?? {}),
  };

  // ---- 14. Assemble ResolvedConfig ----

  const resolved: ResolvedConfig = {
    network_id: network.network_id,
    platform_version: network.platform_version,
    organization: org.organization,
    legal_entity: org.legal_entity,
    company_address: org.company_address,
    domain: site.domain,
    site_name: site.site_name,
    site_tagline: site.site_tagline ?? null,
    group: siteGroups[0],
    groups: siteGroups,
    monetization: monetizationId,
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
  };

  return resolved;
}
