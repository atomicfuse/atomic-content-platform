import { NextRequest, NextResponse } from "next/server";
import {
  readDashboardIndex,
  triggerWorkflowViaPush,
} from "@/lib/github";

const PRODUCTION_ELIGIBLE_STATUSES = new Set(["Live", "WordPress"]);

/**
 * POST /api/sites/rebuild-production
 * Pushes .build-trigger to main for each eligible site, firing sync-kv.yml
 * on main → seeds production KV. Only Live/WordPress sites are synced
 * (others may not have sites/<domain>/ on main yet).
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: { domains: string[]; reason: string };
  try {
    body = (await req.json()) as { domains: string[]; reason: string };
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const { domains, reason } = body;
  if (!Array.isArray(domains) || domains.length === 0) {
    return NextResponse.json(
      { error: "domains[] is required" },
      { status: 400 },
    );
  }

  try {
    const index = await readDashboardIndex();
    const results: Array<{ domain: string; ok: boolean; error?: string }> = [];

    for (const domain of domains) {
      const site = index.sites.find((s) => s.domain === domain);
      if (!site) {
        results.push({ domain, ok: false, error: "Site not found" });
        continue;
      }
      if (!PRODUCTION_ELIGIBLE_STATUSES.has(site.status)) {
        results.push({ domain, ok: false, error: `Status '${site.status}' — skipped` });
        continue;
      }
      try {
        await triggerWorkflowViaPush("main", domain);
        results.push({ domain, ok: true });
      } catch (err) {
        results.push({
          domain,
          ok: false,
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }

    const succeeded = results.filter((r) => r.ok).length;
    return NextResponse.json({
      status: "ok",
      message: `Triggered production sync for ${succeeded} site(s)`,
      reason,
      results,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
