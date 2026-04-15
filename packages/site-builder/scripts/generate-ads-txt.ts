/**
 * Generates the contents of an ads.txt file from the resolved site config.
 *
 * ads.txt is a standard IAB Tech Lab initiative that lets publishers declare
 * authorised digital sellers. Each line in the file represents one seller
 * entry. Entries accumulate additively from all four config layers
 * (org → monetization → group → site) and are deduplicated and sorted.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

import type { ResolvedConfig } from "@atomic-platform/shared-types";

// ---------------------------------------------------------------------------
// Layer source tracking
// ---------------------------------------------------------------------------

export type AdsTxtSourceLayer = "org" | "monetization" | "group" | "site";

export interface AdsTxtBuildOptions {
  /** Optional source breakdown — used to render per-layer comment headers. */
  sources?: Partial<Record<AdsTxtSourceLayer, string[]>>;
  /** ISO date string for the auto-generated header (default: today). */
  generatedAt?: string;
  /** Profile id for monetization layer header annotation. */
  monetizationLabel?: string;
  /** Group label for group layer header annotation. */
  groupLabel?: string;
  /** Org label for org layer header annotation. */
  orgLabel?: string;
}

/**
 * Build the full ads.txt file content from a resolved configuration.
 *
 * @param resolvedConfig - Fully-resolved site configuration.
 * @param options        - Optional source breakdown for per-layer headers.
 */
export function generateAdsTxt(
  resolvedConfig: ResolvedConfig,
  options: AdsTxtBuildOptions = {},
): string {
  const today = options.generatedAt ?? new Date().toISOString().split("T")[0];
  const lines: string[] = [
    `# ads.txt for ${resolvedConfig.domain} — auto-generated ${today}`,
  ];

  if (options.sources) {
    if (options.sources.org && options.sources.org.length > 0) {
      lines.push(`# Source: org${options.orgLabel ? ` (${options.orgLabel})` : ""}`);
    }
    if (options.sources.monetization && options.sources.monetization.length > 0) {
      lines.push(
        `# Source: monetization${options.monetizationLabel ? ` (${options.monetizationLabel})` : ""}`,
      );
    }
    if (options.sources.group && options.sources.group.length > 0) {
      lines.push(`# Source: group${options.groupLabel ? ` (${options.groupLabel})` : ""}`);
    }
    if (options.sources.site && options.sources.site.length > 0) {
      lines.push(`# Source: site`);
    }
  }

  // Normalize, dedupe, sort
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const raw of resolvedConfig.ads_txt) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  normalized.sort();

  return [...lines, ...normalized, ""].join("\n");
}

// ---------------------------------------------------------------------------
// Source-aware ads.txt generation (re-reads layer YAML to attribute entries)
// ---------------------------------------------------------------------------

interface RawLayer {
  ads_txt?: string[];
  ads_config?: { ads_txt?: string[] };
}

async function readLayer(filePath: string): Promise<RawLayer | null> {
  try {
    const raw = await readFile(filePath, "utf-8");
    return (parseYaml(raw) ?? {}) as RawLayer;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

function collectFromLayer(layer: RawLayer | null): string[] {
  if (!layer) return [];
  const top = Array.isArray(layer.ads_txt) ? layer.ads_txt : [];
  const nested = Array.isArray(layer.ads_config?.ads_txt)
    ? layer.ads_config!.ads_txt
    : [];
  return [...top, ...nested]
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter((s) => s.length > 0 && !s.startsWith("#"));
}

export interface BuildAdsTxtForSiteOptions {
  networkRepoPath: string;
  siteDomain: string;
  /** Already-resolved config (used for header line and final ads_txt list). */
  resolvedConfig: ResolvedConfig;
}

/**
 * Build ads.txt for a site by re-reading each config layer YAML so that
 * entries can be attributed to their source layer in the file header.
 *
 * Falls back to the layerless {@link generateAdsTxt} call if any layer
 * file cannot be read (e.g. running against a fixture without all layers).
 */
export async function buildAdsTxtForSite(
  options: BuildAdsTxtForSiteOptions,
): Promise<string> {
  const { networkRepoPath, siteDomain, resolvedConfig } = options;

  const orgLayer = await readLayer(join(networkRepoPath, "org.yaml"));
  const siteLayer = await readLayer(
    join(networkRepoPath, "sites", siteDomain, "site.yaml"),
  );

  // Determine monetization id and group from the resolved config so the
  // header attribution stays consistent with what was actually merged.
  const monetizationId = resolvedConfig.monetization;
  const groupId = resolvedConfig.group;

  const monetizationLayer = monetizationId
    ? await readLayer(
        join(networkRepoPath, "monetization", `${monetizationId}.yaml`),
      )
    : null;
  const groupLayer = groupId
    ? await readLayer(join(networkRepoPath, "groups", `${groupId}.yaml`))
    : null;

  const sources: Record<AdsTxtSourceLayer, string[]> = {
    org: collectFromLayer(orgLayer),
    monetization: collectFromLayer(monetizationLayer),
    group: collectFromLayer(groupLayer),
    site: collectFromLayer(siteLayer),
  };

  return generateAdsTxt(resolvedConfig, {
    sources,
    monetizationLabel: monetizationId || undefined,
    groupLabel: groupId || undefined,
  });
}
