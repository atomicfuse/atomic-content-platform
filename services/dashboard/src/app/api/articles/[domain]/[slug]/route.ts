import { NextRequest, NextResponse } from "next/server";
import { readFileContent, readDashboardIndex } from "@/lib/github";
import { parseFrontmatter, buildArticlePath } from "@/lib/article-upload";

interface RouteParams {
  params: Promise<{ domain: string; slug: string }>;
}

export async function GET(
  _req: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  const { domain, slug } = await params;
  const decodedDomain = decodeURIComponent(domain);

  // Look up staging branch from dashboard index
  const index = await readDashboardIndex();
  const site = index.sites?.find((s) => s.domain === decodedDomain);
  const stagingBranch = site?.staging_branch ?? undefined;

  const articlePath = buildArticlePath(decodedDomain, slug);

  // Try staging branch first, fall back to main
  let content: string | null = null;
  let resolvedBranch = "main";

  if (stagingBranch) {
    content = await readFileContent(articlePath, stagingBranch);
    if (content !== null) resolvedBranch = stagingBranch;
  }
  if (content === null) {
    content = await readFileContent(articlePath);
    resolvedBranch = "main";
  }

  if (content === null) {
    return NextResponse.json(
      { error: `Article "${slug}" not found for ${decodedDomain}` },
      { status: 404 },
    );
  }

  const parsed = parseFrontmatter(content);
  if (!parsed) {
    return NextResponse.json(
      { error: "Could not parse article frontmatter" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    slug,
    frontmatter: parsed.frontmatter,
    body: parsed.body,
    branch: resolvedBranch,
  });
}
