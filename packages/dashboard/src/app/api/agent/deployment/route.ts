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
    // CF deployment stages: "queued" | "initialize" | "clone_repo" | "build" | "deploy" | "active"
    // Status: "idle" | "active" | "success" | "failure"
    const stageStatus = deployment.latest_stage?.status ?? "unknown";
    const deployReady = stageStatus === "success";

    // CF reports "success" when files are deployed, but SSL certs for new
    // branch subdomains take an extra 1-2 min. Verify the URL actually
    // responds before telling the client it's safe to show in an iframe.
    let sslReady = false;
    if (deployReady) {
      const checkUrl = req.nextUrl.searchParams.get("url");
      if (checkUrl) {
        try {
          const probe = await fetch(checkUrl, {
            method: "HEAD",
            redirect: "follow",
            signal: AbortSignal.timeout(5000),
          });
          sslReady = probe.ok || probe.status === 304;
        } catch {
          // SSL not ready yet or timeout — keep polling
          sslReady = false;
        }
      } else {
        // No URL to check — trust the CF API
        sslReady = true;
      }
    }

    return NextResponse.json({
      status: "success",
      id: deployment.id,
      url: deployment.url,
      environment: deployment.environment,
      created_on: deployment.created_on,
      stage: deployment.latest_stage?.name ?? "unknown",
      stage_status: stageStatus,
      is_ready: deployReady && sslReady,
      deploy_ready: deployReady,
      ssl_ready: sslReady,
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
