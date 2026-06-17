import { NextRequest, NextResponse } from "next/server";
import { Octokit } from "@octokit/rest";
import { getDashboardIndex as readDashboardIndex } from "@/lib/db/dashboard-index";
import { NETWORK_REPO_OWNER, NETWORK_REPO_NAME } from "@/lib/constants";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const domain = req.nextUrl.searchParams.get("domain");
  if (!domain) {
    return NextResponse.json(
      { error: "domain query param is required" },
      { status: 400 },
    );
  }

  try {
    const index = await readDashboardIndex();
    const site = index.sites.find((s) => s.domain === domain);
    if (!site) {
      return NextResponse.json({ error: "Site not found" }, { status: 404 });
    }

    const stagingBranch = site.staging_branch;
    if (!stagingBranch) {
      return NextResponse.json({ hasPendingChanges: false, aheadBy: 0, domain });
    }

    // Only relevant for live/ready sites
    if (site.status !== "Ready" && site.status !== "Live") {
      return NextResponse.json({ hasPendingChanges: false, aheadBy: 0, domain });
    }

    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      return NextResponse.json(
        { error: "GITHUB_TOKEN not configured" },
        { status: 500 },
      );
    }

    const octokit = new Octokit({ auth: token });

    const { data } = await octokit.repos.compareCommitsWithBasehead({
      owner: NETWORK_REPO_OWNER,
      repo: NETWORK_REPO_NAME,
      basehead: `main...${stagingBranch}`,
    });

    return NextResponse.json(
      {
        hasPendingChanges: data.ahead_by > 0,
        aheadBy: data.ahead_by,
        domain,
      },
      { headers: { "Cache-Control": "private, max-age=10" } },
    );
  } catch (err) {
    console.error("[sites/staging-status] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to check staging status" },
      { status: 500 },
    );
  }
}
