import { NextRequest, NextResponse } from "next/server";
import { commitSiteFiles } from "@/lib/github";

/**
 * Commit an article to the network repo via GitHub API.
 *
 * Used when the content-generation agent writes locally (LOCAL_NETWORK_PATH)
 * instead of committing to GitHub directly. The dashboard reads the local file
 * and pushes it to GitHub so Cloudflare Pages can pick it up.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json()) as {
    articlePath: string; // e.g. "sites/coolnews.dev/articles/my-article.md"
    localNetworkPath?: string;
  };

  if (!body.articlePath) {
    return NextResponse.json(
      { status: "error", message: "articlePath is required" },
      { status: 400 }
    );
  }

  try {
    // Read the local file
    const fs = await import("node:fs/promises");
    const path = await import("node:path");

    // Determine local network path — check env or use common locations
    const localBase =
      body.localNetworkPath ||
      process.env.LOCAL_NETWORK_PATH ||
      "/Users/michal/Documents/ATL-content-network/atomic-labs-network";

    const fullPath = path.join(localBase, body.articlePath);
    let content: string;
    try {
      content = await fs.readFile(fullPath, "utf-8");
    } catch (err) {
      return NextResponse.json(
        {
          status: "error",
          message: `Could not read local file: ${fullPath}. ${err instanceof Error ? err.message : ""}`,
        },
        { status: 404 }
      );
    }

    // Extract domain from path like "sites/coolnews.dev/articles/my-article.md"
    const parts = body.articlePath.split("/");
    const domain = parts[1] ?? "unknown";
    const slug = path.basename(body.articlePath, ".md");

    await commitSiteFiles(
      domain,
      [{ path: body.articlePath, content }],
      `add article ${slug}`,
    );

    return NextResponse.json({
      status: "committed",
      path: body.articlePath,
      message: `Committed ${body.articlePath} to GitHub`,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to commit article";
    return NextResponse.json(
      { status: "error", message },
      { status: 500 }
    );
  }
}
