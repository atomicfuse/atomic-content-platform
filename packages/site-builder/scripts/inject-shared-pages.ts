/**
 * Shared page injection for the Atomic Content Network Platform.
 *
 * Reads Markdown template files from the shared-pages/ directory, resolves
 * all `{{placeholder}}` tokens using values from the ResolvedConfig, and
 * writes the resulting files to an output directory (typically src/pages/).
 */

import { readFile, writeFile, readdir, mkdir, access } from "node:fs/promises";
import { join, extname } from "node:path";

import type { ResolvedConfig } from "@atomic-platform/shared-types";

// ---------------------------------------------------------------------------
// Placeholder resolution
// ---------------------------------------------------------------------------

/**
 * Resolve all `{{placeholder}}` tokens in a template string using data from
 * the resolved site configuration.
 *
 * Lookup order:
 *  1. Well-known top-level fields (site_name, domain, etc.)
 *  2. Derived values (support_email)
 *  3. Anything in `resolvedConfig.legal`
 *
 * Unrecognised placeholders are left as-is so downstream tooling can detect
 * them.
 *
 * @param template       - Raw Markdown template with `{{placeholder}}` tokens.
 * @param resolvedConfig - Fully-resolved site configuration.
 * @returns The template with all known placeholders replaced.
 */
export function resolveSharedPagePlaceholders(
  template: string,
  resolvedConfig: ResolvedConfig,
): string {
  // Build a flat lookup map of all known placeholder values.
  const supportEmail =
    resolvedConfig.legal["support_email"] ??
    `contact@${resolvedConfig.domain}`;

  const vars: Record<string, string> = {
    // Top-level fields
    site_name: resolvedConfig.site_name,
    domain: resolvedConfig.domain,
    support_email: supportEmail,

    // Legal fields (company_name, company_country, effective_date, etc.)
    company_name: resolvedConfig.legal_entity,
    company_country: resolvedConfig.legal["company_country"] ?? "",
    effective_date: resolvedConfig.legal["effective_date"] ?? "",
    site_description: resolvedConfig.legal["site_description"] ?? "",
    site_email: resolvedConfig.legal["site_email"] ?? supportEmail,

    // Spread remaining legal entries so any custom key is available.
    ...resolvedConfig.legal,
  };

  return template.replace(
    /\{\{(\w+)\}\}/g,
    (_match: string, key: string): string => {
      return vars[key] ?? `{{${key}}}`;
    },
  );
}

// ---------------------------------------------------------------------------
// File injection
// ---------------------------------------------------------------------------

/**
 * Read every `.md` file from `sharedPagesDir`, resolve placeholders using
 * `resolvedConfig`, and write the results to `outputDir`.
 *
 * If an `overridesDir` is provided, the function checks for a site-specific
 * override at `{overridesDir}/{domain}/{fileName}` before falling back to the
 * global default in `sharedPagesDir`.
 *
 * The output directory is created if it does not already exist.
 *
 * @param resolvedConfig - Fully-resolved site configuration.
 * @param sharedPagesDir - Path to the directory containing shared .md templates.
 * @param outputDir      - Path where resolved pages will be written.
 * @param overridesDir   - Optional path to site-specific override directory.
 */
export async function injectSharedPages(
  resolvedConfig: ResolvedConfig,
  sharedPagesDir: string,
  outputDir: string,
  overridesDir?: string,
): Promise<void> {
  // Ensure the output directory exists.
  await mkdir(outputDir, { recursive: true });

  // List all entries in the shared pages directory.
  let entries: string[];
  try {
    entries = await readdir(sharedPagesDir);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      console.warn(
        `[inject-shared-pages] Shared pages directory not found: ${sharedPagesDir}`,
      );
      return;
    }
    throw err;
  }

  const mdFiles = entries.filter((name) => extname(name) === ".md");

  for (const fileName of mdFiles) {
    // Check for a site-specific override first.
    let srcPath = join(sharedPagesDir, fileName);

    if (overridesDir) {
      const overridePath = join(overridesDir, resolvedConfig.domain, fileName);
      try {
        await access(overridePath);
        srcPath = overridePath;
        console.log(
          `[inject-shared-pages] Using override for ${fileName}: ${overridePath}`,
        );
      } catch {
        // No override found — use the global default.
      }
    }

    const template = await readFile(srcPath, "utf-8");
    const resolved = resolveSharedPagePlaceholders(template, resolvedConfig);
    const destPath = join(outputDir, fileName);

    await writeFile(destPath, resolved, "utf-8");
    console.log(`[inject-shared-pages] Wrote ${destPath}`);
  }
}
