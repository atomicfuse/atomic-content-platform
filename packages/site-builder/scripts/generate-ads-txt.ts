/**
 * Generates the contents of an ads.txt file from the resolved site config.
 *
 * ads.txt is a standard IAB Tech Lab initiative that lets publishers declare
 * authorised digital sellers.  Each line in the file represents one seller
 * entry.  This helper simply joins the pre-merged array that the config
 * resolver already assembled from org -> group layers.
 */

import type { ResolvedConfig } from "@atomic-platform/shared-types";

/**
 * Build the full ads.txt file content from a resolved configuration.
 *
 * @param resolvedConfig - Fully-resolved site configuration.
 * @returns The ads.txt file content as a single string (newline-separated).
 */
export function generateAdsTxt(resolvedConfig: ResolvedConfig): string {
  return resolvedConfig.ads_txt.join("\n");
}
