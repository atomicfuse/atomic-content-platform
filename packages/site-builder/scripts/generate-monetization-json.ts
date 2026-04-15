/**
 * CDN JSON generation pipeline.
 *
 * For each site that uses (directly or by org default) a monetization
 * profile, write `<outputDir>/<domain>.json` containing the resolved
 * MonetizationJson. The platform serves these files at
 * `https://cdn.atomicnetwork.com/m/<domain>.json` and the runtime
 * `ad-loader.js` fetches them on every page load.
 *
 * This pipeline is decoupled from site builds: editing
 * `monetization/<id>.yaml` only re-runs this script, never a full
 * Astro rebuild. See `detect-changed-sites.ts` for the build filter.
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

import type { MonetizationJson } from "@atomic-platform/shared-types";

import { resolveMonetization } from "./resolve-monetization.js";

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
  /** The resolved monetization JSON content. */
  json: MonetizationJson;
}

/**
 * Generate the monetization JSON file for a single site.
 *
 * Throws if the site has no monetization profile (no per-site value AND
 * no org `default_monetization`) — the CDN must always serve a usable
 * config or `ad-loader.js` will fall back to its localStorage cache.
 */
export async function generateMonetizationJson(
  options: GenerateMonetizationJsonOptions,
): Promise<GenerateMonetizationJsonResult> {
  const json = await resolveMonetization({
    networkRepoPath: options.networkRepoPath,
    siteDomain: options.siteDomain,
  });

  const outputPath = join(options.outputDir, `${options.siteDomain}.json`);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(json, null, 2), "utf-8");

  return { outputPath, json };
}

/**
 * Generate JSON files for every site directory under `<network>/sites/`.
 *
 * Sites that don't resolve to a monetization profile are skipped and
 * reported in `errors`. The pipeline never aborts on a single site
 * failure — one bad site config shouldn't block the rest of the network.
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
        // ignore unknown flags
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
      console.log(`[mon-json] ✓ ${r.outputPath}`);
    }
    for (const e of errors) {
      console.warn(`[mon-json] ✗ ${e.siteDomain}: ${e.error}`);
    }
    if (errors.length > 0 && succeeded.length === 0) process.exit(1);
    return;
  }

  const result = await generateMonetizationJson({
    networkRepoPath: args.network,
    siteDomain: args.site!,
    outputDir: args.out,
  });
  console.log(`[mon-json] ✓ ${result.outputPath}`);
}

if (process.argv[1] === __filename) {
  main().catch((err: unknown) => {
    console.error(
      "[mon-json] failed:",
      err instanceof Error ? err.message : err,
    );
    process.exit(1);
  });
}
