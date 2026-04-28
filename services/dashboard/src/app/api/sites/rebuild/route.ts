import { NextRequest, NextResponse } from "next/server";
import {
  readDashboardIndex,
  triggerWorkflowViaPush,
} from "@/lib/github";

interface RebuildRequestBody {
  domains: string[];
  reason: string;
}

/**
 * POST /api/sites/rebuild
 * Pushes a .build-trigger file to each site's staging branch, which fires
 * the sync-kv workflow (via GitHub push event) to seed KV + R2.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: RebuildRequestBody;
  try {
    body = (await req.json()) as RebuildRequestBody;
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

    // Trigger syncs sequentially to avoid GitHub API rate limits
    for (const domain of domains) {
      const site = index.sites.find((s) => s.domain === domain);
      if (!site?.staging_branch) {
        results.push({ domain, ok: false, error: "No staging branch" });
        continue;
      }
      try {
        await triggerWorkflowViaPush(site.staging_branch, domain);
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
      message: `Triggered sync for ${succeeded}/${domains.length} site(s)`,
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
