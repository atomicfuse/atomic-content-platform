"use server";

import { publishStagingToProduction } from "@/actions/wizard";

export type BulkPublishSiteResult = { ok: true } | { ok: false; error: string };

const MAX_ERROR_LENGTH = 500;

/**
 * Bulk "Publish changes" entry point for one site. Calls the unchanged
 * `publishStagingToProduction` and returns the failure reason as data:
 * Next.js replaces the message of an error *thrown* from a server action
 * with a generic one in production builds, so a thrown error would hide why
 * a site failed. Only `err.message` is returned (no stack, no request data).
 */
export async function bulkPublishSite(domain: string): Promise<BulkPublishSiteResult> {
  try {
    await publishStagingToProduction(domain);
    return { ok: true };
  } catch (err) {
    console.error(`[bulk-publish] publish failed for ${domain}:`, err);
    const message = err instanceof Error && err.message ? err.message : "Publish failed";
    return { ok: false, error: message.slice(0, MAX_ERROR_LENGTH) };
  }
}
