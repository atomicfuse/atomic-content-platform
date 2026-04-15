/**
 * Lighter resolver used by the CDN JSON pipeline.
 *
 * Merges only the monetization-relevant fields (tracking, scripts,
 * ads_config) across the layers that care about ads:
 *   org -> monetization -> site
 *
 * The group layer is intentionally skipped because groups are editorial-only
 * under the monetization architecture. ads_txt and ad_placeholder_heights are
 * not included — those live in separate outputs (ads.txt file and HTML).
 *
 * Output: MonetizationJson — the document served at
 * https://cdn.<network>/m/<domain>.json and consumed by ad-loader.js.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";

import type {
  AdsConfig,
  AdPlacement,
  MonetizationConfig,
  MonetizationJson,
  OrgConfig,
  ScriptEntry,
  ScriptsConfig,
  SiteConfig,
  TrackingConfig,
} from "@atomic-platform/shared-types";

// ---------------------------------------------------------------------------
// YAML helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Merge helpers (same semantics as resolve-config but localized here)
// ---------------------------------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function deepMerge<T extends Record<string, unknown>>(
  target: T,
  source: Record<string, unknown>,
): T {
  const result: Record<string, unknown> = { ...target };
  for (const key of Object.keys(source)) {
    const srcVal = source[key];
    const tgtVal = result[key];
    if (srcVal === undefined) continue;
    if (srcVal === null) {
      result[key] = null;
      continue;
    }
    if (isPlainObject(srcVal) && isPlainObject(tgtVal)) {
      result[key] = deepMerge(tgtVal as Record<string, unknown>, srcVal);
    } else {
      result[key] = srcVal;
    }
  }
  return result as T;
}

function mergeScriptArrays(parent: ScriptEntry[], child: ScriptEntry[]): ScriptEntry[] {
  const merged = new Map<string, ScriptEntry>();
  for (const entry of parent) merged.set(entry.id, entry);
  for (const entry of child) merged.set(entry.id, entry);
  return Array.from(merged.values());
}

function mergeScriptsConfigs(parent: ScriptsConfig, child: Partial<ScriptsConfig>): ScriptsConfig {
  return {
    head: child.head ? mergeScriptArrays(parent.head, child.head) : parent.head,
    body_start: child.body_start ? mergeScriptArrays(parent.body_start, child.body_start) : parent.body_start,
    body_end: child.body_end ? mergeScriptArrays(parent.body_end, child.body_end) : parent.body_end,
  };
}

function normaliseScriptEntry(raw: Record<string, unknown>): ScriptEntry {
  const entry: ScriptEntry = { id: raw["id"] as string };
  if (raw["src"] !== undefined) entry.src = raw["src"] as string;
  if (raw["content"] !== undefined) entry.inline = raw["content"] as string;
  if (raw["inline"] !== undefined) entry.inline = raw["inline"] as string;
  if (raw["async"] !== undefined) entry.async = raw["async"] as boolean;
  return entry;
}

function normaliseScriptsConfig(raw: Record<string, unknown>): ScriptsConfig {
  const mapArr = (a: unknown[] | undefined) =>
    (a ?? []).map((x) => normaliseScriptEntry(x as Record<string, unknown>));
  return {
    head: mapArr(raw["head"] as unknown[] | undefined),
    body_start: mapArr(raw["body_start"] as unknown[] | undefined),
    body_end: mapArr(raw["body_end"] as unknown[] | undefined),
  };
}

function normaliseAdPlacements(placements: unknown[]): AdPlacement[] {
  return placements.map((raw) => {
    const p = raw as Record<string, unknown>;
    const id = p["id"] as string;
    const position = p["position"] as string;
    const device = (p["device"] ?? p["devices"] ?? "all") as "all" | "desktop" | "mobile";

    let sizes: { desktop?: number[][]; mobile?: number[][] };
    const rawSizes = p["sizes"];
    if (rawSizes && typeof rawSizes === "object" && !Array.isArray(rawSizes)) {
      sizes = rawSizes as { desktop?: number[][]; mobile?: number[][] };
    } else if (Array.isArray(rawSizes)) {
      const parsed: number[][] = rawSizes.map((s: unknown) => {
        if (typeof s === "string") return s.split("x").map(Number);
        if (Array.isArray(s)) return s as number[];
        return [0, 0];
      });
      if (device === "mobile") sizes = { desktop: [], mobile: parsed };
      else if (device === "desktop") sizes = { desktop: parsed, mobile: [] };
      else sizes = { desktop: parsed, mobile: parsed };
    } else {
      sizes = { desktop: [], mobile: [] };
    }
    return { id, position, sizes, device };
  });
}

function resolveString(value: string, vars: Record<string, string>): string {
  return value.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => vars[key] ?? `{{${key}}}`);
}

function resolveTemplates(value: unknown, vars: Record<string, string>): unknown {
  if (typeof value === "string") return resolveString(value, vars);
  if (Array.isArray(value)) return value.map((v) => resolveTemplates(v, vars));
  if (isPlainObject(value)) {
    const r: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) r[k] = resolveTemplates(v, vars);
    return r;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Main resolver (CDN JSON)
// ---------------------------------------------------------------------------

export interface ResolveMonetizationOptions {
  networkRepoPath: string;
  siteDomain: string;
}

/**
 * Build the CDN JSON document for a given site by merging
 * org -> monetization -> site (skipping the group layer).
 *
 * Throws when the monetization profile id cannot be resolved to a file,
 * or when placeholders remain unresolved after substitution.
 */
export async function resolveMonetization(
  options: ResolveMonetizationOptions,
): Promise<MonetizationJson> {
  const { networkRepoPath, siteDomain } = options;

  const orgPath = join(networkRepoPath, "org.yaml");
  const sitePath = join(networkRepoPath, "sites", siteDomain, "site.yaml");

  const orgRaw = await readYaml<Record<string, unknown>>(orgPath);
  const siteRaw = await readYaml<Record<string, unknown>>(sitePath);

  const org = orgRaw as unknown as OrgConfig;
  const site = siteRaw as unknown as SiteConfig;

  // Determine monetization id with fallback chain.
  const monetizationId =
    (typeof siteRaw["monetization"] === "string" ? (siteRaw["monetization"] as string) : undefined)
    ?? (typeof orgRaw["default_monetization"] === "string" ? (orgRaw["default_monetization"] as string) : undefined);

  if (!monetizationId) {
    throw new Error(
      `Cannot resolve monetization for ${siteDomain}: no monetization specified on site and no default_monetization on org`,
    );
  }

  const monetizationPath = join(networkRepoPath, "monetization", `${monetizationId}.yaml`);
  const monetizationRaw = await readYamlOptional<Record<string, unknown>>(monetizationPath);
  if (!monetizationRaw) {
    throw new Error(
      `Monetization profile "${monetizationId}" not found. Expected file at monetization/${monetizationId}.yaml`,
    );
  }
  const monetization = monetizationRaw as unknown as MonetizationConfig;

  // ---- tracking: org -> monetization -> site ----
  let tracking: TrackingConfig = { ...org.tracking };
  if (monetization.tracking) {
    tracking = deepMerge(
      tracking as unknown as Record<string, unknown>,
      monetization.tracking as unknown as Record<string, unknown>,
    ) as unknown as TrackingConfig;
  }
  if (site.tracking) {
    tracking = deepMerge(
      tracking as unknown as Record<string, unknown>,
      site.tracking as unknown as Record<string, unknown>,
    ) as unknown as TrackingConfig;
  }

  // ---- scripts: org -> monetization (site does not contribute scripts here) ----
  const orgScripts: ScriptsConfig = orgRaw["scripts"]
    ? normaliseScriptsConfig(orgRaw["scripts"] as Record<string, unknown>)
    : { head: [], body_start: [], body_end: [] };

  let mergedScripts: ScriptsConfig = orgScripts;
  if (monetizationRaw["scripts"]) {
    const monScripts = normaliseScriptsConfig(monetizationRaw["scripts"] as Record<string, unknown>);
    mergedScripts = mergeScriptsConfigs(mergedScripts, monScripts);
  }

  // scripts_vars (org + monetization + site) used for placeholder expansion
  const vars: Record<string, string> = {
    ...((orgRaw["scripts_vars"] as Record<string, string>) ?? {}),
    ...((monetizationRaw["scripts_vars"] as Record<string, string>) ?? {}),
    ...((site.scripts_vars as Record<string, string>) ?? {}),
    domain: siteDomain,
  };
  mergedScripts = resolveTemplates(mergedScripts, vars) as ScriptsConfig;

  const remaining = JSON.stringify(mergedScripts).match(/\{\{(\w+)\}\}/g);
  if (remaining && remaining.length > 0) {
    const unique = [...new Set(remaining)];
    throw new Error(
      `Unresolved placeholders in scripts: ${unique.join(", ")}. ` +
      `Define these in scripts_vars at org, monetization, or site level.`,
    );
  }

  // ---- ads_config: org -> monetization -> site ----
  let adsConfig: AdsConfig = { ...org.ads_config };
  if (monetization.ads_config) {
    adsConfig = deepMerge(
      adsConfig as unknown as Record<string, unknown>,
      monetization.ads_config as unknown as Record<string, unknown>,
    ) as unknown as AdsConfig;
  }
  if (site.ads_config) {
    adsConfig = deepMerge(
      adsConfig as unknown as Record<string, unknown>,
      site.ads_config as unknown as Record<string, unknown>,
    ) as unknown as AdsConfig;
  }

  // Placement precedence: site > monetization > org
  const placementSources: unknown[] | undefined =
    (site.ads_config?.ad_placements as unknown[] | undefined)
    ?? (monetization.ads_config?.ad_placements as unknown[] | undefined)
    ?? (org.ads_config?.ad_placements as unknown[] | undefined);

  if (placementSources && placementSources.length > 0) {
    adsConfig = { ...adsConfig, ad_placements: normaliseAdPlacements(placementSources) };
  }

  const result: MonetizationJson = {
    domain: siteDomain,
    monetization_id: monetizationId,
    tracking,
    scripts: mergedScripts,
    ads_config: adsConfig,
    generated_at: new Date().toISOString(),
  };

  return result;
}
