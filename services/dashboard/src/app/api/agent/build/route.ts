import { NextRequest, NextResponse } from "next/server";
import { triggerPagesBuild } from "@/lib/cloudflare";
import { triggerWorkflowViaPush } from "@/lib/github";

/**
 * Trigger a Cloudflare Pages build for a project.
 * POST { projectName, stagingBranch?, domain? }
 *
 * When stagingBranch and domain are provided, pushes a .build-trigger file
 * to the staging branch via the Contents API. This fires a GitHub webhook
 * that Cloudflare Pages picks up, deploying the staging branch.
 *
 * Without stagingBranch, falls back to triggering a build via the CF API
 * (which deploys the production branch).
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json()) as {
    projectName: string;
    stagingBranch?: string | null;
    domain?: string | null;
  };

  if (!body.projectName) {
    return NextResponse.json(
      { status: "error", message: "projectName is required" },
      { status: 400 }
    );
  }

  try {
    // When a staging branch is provided, push a trigger file so the GitHub
    // webhook fires and Cloudflare deploys the staging branch.
    if (body.stagingBranch && body.domain) {
      await triggerWorkflowViaPush(body.stagingBranch, body.domain);
      const branchSlug = body.stagingBranch.replace(/\//g, "-");
      return NextResponse.json({
        status: "success",
        id: `trigger-${Date.now()}`,
        url: `https://${branchSlug}.${body.projectName}.pages.dev`,
      });
    }

    const result = await triggerPagesBuild(body.projectName);
    return NextResponse.json({
      status: "success",
      id: result.id,
      url: result.url,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to trigger build";
    return NextResponse.json(
      { status: "error", message },
      { status: 500 }
    );
  }
}
