/**
 * @deprecated The separate monetization resolver has been replaced by the
 * unified groups + overrides architecture. Use resolveConfig() from
 * resolve-config.ts instead, which produces inlineAdConfig on the output.
 *
 * This file is kept as a thin wrapper for backward compatibility with
 * scripts that still call resolveMonetization(). It delegates to
 * resolveConfig() and maps the output to the legacy shape.
 */

import type { InlineAdConfig } from "@atomic-platform/shared-types";

import { resolveConfig } from "./resolve-config.js";

export interface ResolveMonetizationOptions {
  networkRepoPath: string;
  siteDomain: string;
}

/**
 * @deprecated Use resolveConfig() instead.
 */
export async function resolveMonetization(
  options: ResolveMonetizationOptions,
): Promise<InlineAdConfig> {
  const resolved = await resolveConfig(
    options.networkRepoPath,
    options.siteDomain,
  );

  if (!resolved.inlineAdConfig) {
    throw new Error(
      `Cannot resolve config for ${options.siteDomain}: no inline ad config produced.`,
    );
  }

  return resolved.inlineAdConfig;
}
