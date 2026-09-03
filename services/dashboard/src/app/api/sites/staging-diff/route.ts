import { NextRequest, NextResponse } from "next/server";
import { Octokit } from "@octokit/rest";
import { getDashboardIndex as readDashboardIndex } from "@/lib/db/dashboard-index";
import { NETWORK_REPO_OWNER, NETWORK_REPO_NAME } from "@/lib/constants";

export interface StagingDiffFile {
  filename: string;
  status: "added" | "removed" | "modified" | "renamed";
  additions: number;
  deletions: number;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const domain = req.nextUrl.searchParams.get("domain");
  if (!domain) {
    return NextResponse.json({ error: "domain required" }, { status: 400 });
  }

  const index = await readDashboardIndex();
  const site = index.sites.find((s) => s.domain === domain);
  if (!site?.staging_branch) {
    return NextResponse.json({ files: [], aheadBy: 0 });
  }

  try {
    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
    const { data } = await octokit.repos.compareCommitsWithBasehead({
      owner: NETWORK_REPO_OWNER,
      repo: NETWORK_REPO_NAME,
      basehead: `main...${site.staging_branch}`,
    });

    // Only show files belonging to this domain — staging branches may
    // contain cross-domain changes from batch operations (e.g. topic backfill).
    const domainPrefix = `sites/${domain}/`;
    const files: StagingDiffFile[] = (data.files ?? [])
      .filter((f) => f.filename.startsWith(domainPrefix))
      .map((f) => ({
        filename: f.filename,
        status: f.status as StagingDiffFile["status"],
        additions: f.additions,
        deletions: f.deletions,
      }));

    return NextResponse.json({
      files,
      aheadBy: data.ahead_by,
      behindBy: data.behind_by,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to compare branches";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
