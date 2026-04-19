/**
 * Inline config JSON generation pipeline.
 *
 * For each site, writes `<outputDir>/<domain>.json` containing the resolved
 * InlineAdConfig. The platform serves these files at the CDN endpoint and
 * the runtime `ad-loader.js` fetches them as a fallback when the inline
 * config is not available.
 *
 * This pipeline uses resolveConfig() from the unified groups + overrides
 * architecture.
 *
 * Usage as CLI:
 *   tsx generate-monetization-json.ts \
 *     --network <path> --site <domain> --out <dir>
 *   tsx generate-monetization-json.ts \
 *     --network <path> --all --out <dir>
 */

import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { InlineAdConfig } from "@atomic-platform/shared-types";

import { resolveConfig } from "./resolve-config.js";

const __filename = fileURLToPath(import.meta.url);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface GenerateMonetizationJsonOptions {
  /** Absolute path to the network data repo root. */
  networkRepoPath: string;
  /** Site domain to generate JSON for. */
  siteDomain: string;
  /** Directory where `<domain>.json` will be written. */
  outputDir: string;
}

export interface GenerateMonetizationJsonResult {
  /** Absolute path to the written JSON file. */
  outputPath: string;
  /** The resolved inline ad config JSON content. */
  json: InlineAdConfig;
}

/**
 * Generate the inline config JSON file for a single site.
 */
export async function generateMonetizationJson(
  options: GenerateMonetizationJsonOptions,
): Promise<GenerateMonetizationJsonResult> {
  const resolved = await resolveConfig(
    options.networkRepoPath,
    options.siteDomain,
  );

  const json = resolved.inlineAdConfig;
  const outputPath = join(options.outputDir, `${options.siteDomain}.json`);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(json, null, 2), "utf-8");

  return { outputPath, json };
}

/**
 * Generate JSON files for every site directory under `<network>/sites/`.
 */
export async function generateAllMonetizationJson(
  networkRepoPath: string,
  outputDir: string,
): Promise<{
  succeeded: GenerateMonetizationJsonResult[];
  errors: { siteDomain: string; error: string }[];
}> {
  const sitesDir = join(networkRepoPath, "sites");
  let entries: string[];
  try {
    entries = await readdir(sitesDir);
  } catch {
    return { succeeded: [], errors: [] };
  }

  const succeeded: GenerateMonetizationJsonResult[] = [];
  const errors: { siteDomain: string; error: string }[] = [];

  for (const entry of entries) {
    const sitePath = join(sitesDir, entry);
    let isDir = false;
    try {
      isDir = (await stat(sitePath)).isDirectory();
    } catch {
      continue;
    }
    if (!isDir) continue;

    try {
      const result = await generateMonetizationJson({
        networkRepoPath,
        siteDomain: entry,
        outputDir,
      });
      succeeded.push(result);
    } catch (err) {
      errors.push({
        siteDomain: entry,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { succeeded, errors };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

interface CliArgs {
  network: string;
  out: string;
  site?: string;
  all: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const result: Partial<CliArgs> = { all: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const next = argv[i + 1];
    switch (flag) {
      case "--network":
        result.network = next;
        i += 1;
        break;
      case "--site":
        result.site = next;
        i += 1;
        break;
      case "--out":
        result.out = next;
        i += 1;
        break;
      case "--all":
        result.all = true;
        break;
      default:
        break;
    }
  }
  if (!result.network) throw new Error("--network <path> is required");
  if (!result.out) throw new Error("--out <dir> is required");
  if (!result.all && !result.site) {
    throw new Error("Either --site <domain> or --all must be provided");
  }
  return result as CliArgs;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.all) {
    const { succeeded, errors } = await generateAllMonetizationJson(
      args.network,
      args.out,
    );
    for (const r of succeeded) {
      console.log(`[config-json] ${r.outputPath}`);
    }
    for (const e of errors) {
      console.warn(`[config-json] ${e.siteDomain}: ${e.error}`);
    }
    if (errors.length > 0 && succeeded.length === 0) process.exit(1);
    return;
  }

  const result = await generateMonetizationJson({
    networkRepoPath: args.network,
    siteDomain: args.site!,
    outputDir: args.out,
  });
  console.log(`[config-json] ${result.outputPath}`);
}

if (process.argv[1] === __filename) {
  main().catch((err: unknown) => {
    console.error(
      "[config-json] failed:",
      err instanceof Error ? err.message : err,
    );
    process.exit(1);
  });
}
