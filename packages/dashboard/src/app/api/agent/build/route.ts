import { NextRequest, NextResponse } from "next/server";
import { triggerPagesBuild } from "@/lib/cloudflare";

/**
 * Trigger a Cloudflare Pages build for a project.
 * POST { projectName, environment }
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json()) as {
    projectName: string;
    environment?: string;
  };

  if (!body.projectName) {
    return NextResponse.json(
      { status: "error", message: "projectName is required" },
      { status: 400 }
    );
  }

  try {
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
