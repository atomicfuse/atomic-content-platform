import { NextRequest, NextResponse } from "next/server";
import { getLatestDeployment } from "@/lib/cloudflare";

/**
 * Get the latest deployment URL for a Cloudflare Pages project.
 * GET /api/agent/deployment?project=coolnews-dev
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const project = req.nextUrl.searchParams.get("project");

  if (!project) {
    return NextResponse.json(
      { status: "error", message: "project query param is required" },
      { status: 400 }
    );
  }

  try {
    const deployment = await getLatestDeployment(project);
    if (!deployment) {
      return NextResponse.json({ status: "no_deployment" });
    }
    return NextResponse.json({
      status: "success",
      id: deployment.id,
      url: deployment.url,
      environment: deployment.environment,
      created_on: deployment.created_on,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch deployment";
    return NextResponse.json(
      { status: "error", message },
      { status: 500 }
    );
  }
}
