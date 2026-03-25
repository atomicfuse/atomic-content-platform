/**
 * Config Resolver for the Atomic Content Network Platform.
 *
 * Reads YAML config files from a network data repo, deep-merges them
 * following the inheritance chain (org -> group -> site), resolves all
 * {{placeholder}} variables, and returns a fully-typed ResolvedConfig.
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
} from "@atomic-platform/shared-types";
import type { NetworkManifest } from "@atomic-platform/shared-types";
import type { ScriptEntry, AdsConfig } from "@atomic-platform/shared-types";
import type { TrackingConfig } from "@atomic-platform/shared-types";

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
// Main resolver
// ---------------------------------------------------------------------------

/**
 * Resolve a site's full configuration by reading YAML files from the network
 * data repository and deep-merging them: org -> group -> site.
 *
 * @param networkRepoPath - Absolute path to the network data repository root.
 * @param siteDomain - Domain name of the site to resolve (e.g. "coolnews.dev").
 * @returns Fully resolved configuration with all placeholders replaced.
 */
export async function resolveConfig(
  networkRepoPath: string,
  siteDomain: string,
): Promise<ResolvedConfig> {
  // ---- 1. Read all config files ----

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

  // Cast to typed configs (after reading raw for flexibility)
  const org = orgRaw as unknown as OrgConfig;
  const site = siteRaw as unknown as SiteConfig;

  // Validate required site fields
  if (!site.domain) {
    throw new Error(`site.yaml for ${siteDomain} is missing required field: domain`);
  }
  if (!site.group) {
    throw new Error(`site.yaml for ${siteDomain} is missing required field: group`);
  }

  // ---- 2. Read group config ----

  const groupPath = join(networkRepoPath, "groups", `${site.group}.yaml`);
  let groupRaw: Record<string, unknown>;
  try {
    groupRaw = await readYaml<Record<string, unknown>>(groupPath);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.startsWith("Config file not found")) {
      throw new Error(
        `Site "${siteDomain}" references group "${site.group}", but group file not found: ${groupPath}`,
      );
    }
    throw err;
  }
  const group = groupRaw as unknown as GroupConfig;

  // ---- 3. Merge tracking: org -> group -> site ----

  let tracking: TrackingConfig = { ...org.tracking };
  if (group.tracking) {
    tracking = deepMerge(tracking as unknown as Record<string, unknown>, group.tracking as unknown as Record<string, unknown>) as unknown as TrackingConfig;
  }
  if (site.tracking) {
    tracking = deepMerge(tracking as unknown as Record<string, unknown>, site.tracking as unknown as Record<string, unknown>) as unknown as TrackingConfig;
  }

  // ---- 4. Merge scripts: org -> group (by id) ----

  const orgScripts: ScriptsConfig = orgRaw["scripts"]
    ? normaliseScriptsConfig(orgRaw["scripts"] as Record<string, unknown>)
    : { head: [], body_start: [], body_end: [] };

  let mergedScripts: ScriptsConfig = orgScripts;

  if (groupRaw["scripts"]) {
    const groupScripts = normaliseScriptsConfig(
      groupRaw["scripts"] as Record<string, unknown>,
    );
    mergedScripts = mergeScriptsConfigs(mergedScripts, groupScripts);
  }

  // ---- 5. Merge scripts_vars from all levels, then resolve placeholders ----

  // scripts_vars can appear at org, group, or site level
  const orgVars = (orgRaw["scripts_vars"] as Record<string, string>) ?? {};
  const groupVars = (groupRaw["scripts_vars"] as Record<string, string>) ?? {};
  const siteVars = (site.scripts_vars as Record<string, string>) ?? {};

  const allVars: Record<string, string> = {
    ...orgVars,
    ...groupVars,
    ...siteVars,
    domain: siteDomain,
  };

  // Resolve placeholders in the scripts tree
  mergedScripts = resolveTemplates(mergedScripts, allVars) as ScriptsConfig;

  // ---- 6. Merge ads_config: org -> group -> site ----

  let adsConfig: AdsConfig = { ...org.ads_config };
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

  // ---- 7. Merge ads_txt: group replaces org if present ----

  // Parse ads_txt - it can be a multiline string or an array
  let adsTxt: string[] = [];
  const orgAdsTxt = (orgRaw["ads_config"] as Record<string, unknown> | undefined)?.["ads_txt"];
  if (Array.isArray(orgAdsTxt)) {
    adsTxt = orgAdsTxt as string[];
  }

  // Group ads_txt replaces entirely (it's a top-level field, not in ads_config)
  const groupAdsTxt = groupRaw["ads_txt"];
  if (groupAdsTxt !== undefined) {
    if (typeof groupAdsTxt === "string") {
      adsTxt = groupAdsTxt
        .split("\n")
        .map((line: string) => line.trim())
        .filter((line: string) => line.length > 0);
    } else if (Array.isArray(groupAdsTxt)) {
      adsTxt = groupAdsTxt as string[];
    }
  }

  // ---- 8. Merge theme: org defaults -> group -> site ----

  const theme = resolveTheme(org, group.theme, site.theme);

  // ---- 9. Merge legal: org -> group -> site ----

  let legal: Record<string, string> = { ...(org.legal ?? {}) };
  if (group.legal_pages_override) {
    legal = { ...legal, ...group.legal_pages_override };
  }
  if (site.legal) {
    legal = { ...legal, ...site.legal };
  }

  // ---- 10. Resolve support email ----

  const supportEmail = resolveString(
    org.support_email_pattern ?? "",
    { domain: siteDomain },
  );

  // ---- 11. Merge feature configs: org -> group -> site with defaults ----

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
  // For sidebar, widgets array should be replaced entirely (not merged)
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

  // ---- 12. Assemble ResolvedConfig ----

  const resolved: ResolvedConfig = {
    network_id: network.network_id,
    platform_version: network.platform_version,
    organization: org.organization,
    legal_entity: org.legal_entity,
    company_address: org.company_address,
    domain: site.domain,
    site_name: site.site_name,
    site_tagline: site.site_tagline ?? null,
    group: site.group,
    active: site.active,
    tracking,
    scripts: mergedScripts,
    ads_txt: adsTxt,
    ads_config: adsConfig,
    theme,
    brief: site.brief,
    legal,
    preview_page: previewPage,
    categories,
    sidebar: sidebarMerged,
    search,
  };

  return resolved;
}
