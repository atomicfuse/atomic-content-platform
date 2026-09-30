import { NextRequest, NextResponse } from "next/server";
import { Octokit } from "@octokit/rest";
import { getDashboardIndex as readDashboardIndex } from "@/lib/db/dashboard-index";
import { NETWORK_REPO_OWNER, NETWORK_REPO_NAME } from "@/lib/constants";
import {
  isPublishEligible,
  summarisePendingFiles,
  type PendingChangesResponse,
  type PendingScanError,
  type PendingSite,
} from "@/lib/pending-changes";
import type { DashboardSiteEntry } from "@/types/dashboard";

const SCAN_CONCURRENCY = 5;
const COMPARE_TIMEOUT_MS = 20_000;

/**
 * GET /api/sites/pending-changes[?domain=<domain>]
 *
 * Read-only scan for the bulk "Publish changes" flow. Compares
 * `main...<staging_branch>` for every Ready/Live site with a staging branch
 * (same call and `sites/<domain>/` filter as `staging-status`) and returns
 * only the sites with at least one pending file. A failed compare lands in
 * `errors` and never fails the whole scan. `?domain=` re-checks one site.
 * Not cached: every call is an explicit user action.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const domainParam = req.nextUrl.searchParams.get("domain");

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "GITHUB_TOKEN not configured: cannot check staging branches for pending changes" },
      { status: 500 },
    );
  }

  let candidates: DashboardSiteEntry[];
  try {
    const index = await readDashboardIndex();
    if (domainParam) {
      const site = index.sites.find((s) => s.domain === domainParam);
      if (!site) {
        return NextResponse.json({ error: "Site not found" }, { status: 404 });
      }
      candidates = isPublishEligible(site) ? [site] : [];
    } else {
      candidates = index.sites.filter(isPublishEligible);
    }
  } catch (err) {
    console.error("[sites/pending-changes] failed to read dashboard index:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to read the site list" },
      { status: 500 },
    );
  }

  const octokit = new Octokit({ auth: token });
  const results: Array<PendingSite | null> = new Array(candidates.length).fill(null);
  const errors: Array<PendingScanError | null> = new Array(candidates.length).fill(null);

  async function scanOne(i: number): Promise<void> {
    const site = candidates[i]!;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), COMPARE_TIMEOUT_MS);
    try {
      const compare = octokit.repos.compareCommitsWithBasehead({
        owner: NETWORK_REPO_OWNER,
        repo: NETWORK_REPO_NAME,
        basehead: `main...${site.staging_branch}`,
        request: { signal: controller.signal },
      });
      const timeout = new Promise<never>((_, reject) => {
        controller.signal.addEventListener("abort", () =>
          reject(new Error(`Timed out after ${COMPARE_TIMEOUT_MS / 1000}s comparing staging to main`)),
        );
      });
      const { data } = await Promise.race([compare, timeout]);
      const summary = summarisePendingFiles(site.domain, data.files ?? []);
      if (summary.files.length > 0) {
        results[i] = { domain: site.domain, status: site.status, ...summary };
      }
    } catch (err) {
      console.error(`[sites/pending-changes] compare failed for ${site.domain}:`, err);
      errors[i] = {
        domain: site.domain,
        message: err instanceof Error ? err.message : "Failed to compare staging to main",
      };
    } finally {
      clearTimeout(timer);
    }
  }

  // Fixed-size worker pool: each worker pulls the next index until done.
  let next = 0;
  async function worker(): Promise<void> {
    while (next < candidates.length) {
      const i = next++;
      await scanOne(i);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(SCAN_CONCURRENCY, candidates.length) }, () => worker()),
  );

  const body: PendingChangesResponse = {
    scannedAt: new Date().toISOString(),
    scanned: candidates.length,
    sites: results.filter((r): r is PendingSite => r !== null),
    errors: errors.filter((e): e is PendingScanError => e !== null),
    ...(domainParam ? { eligible: candidates.length === 1 } : {}),
  };
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
