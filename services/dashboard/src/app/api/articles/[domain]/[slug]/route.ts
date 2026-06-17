import { NextRequest, NextResponse } from "next/server";
import matter from "gray-matter";
import { getDashboardIndex as readDashboardIndex } from "@/lib/db/dashboard-index";
import { readFileContent, commitNetworkFiles } from "@/lib/github";
import { parseFrontmatter, buildArticlePath } from "@/lib/article-upload";
import { upsertArticleMeta } from "@/lib/db/articles";

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

export async function PATCH(
  req: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  const { domain, slug } = await params;
  const decodedDomain = decodeURIComponent(domain);
  const body = await req.json();
  const { content, branch: branchOverride } = body as { content: string; branch?: string };

  if (!content || typeof content !== "string") {
    return NextResponse.json({ error: "content is required" }, { status: 400 });
  }

  // Determine branch
  let branch = branchOverride;
  if (!branch) {
    const index = await readDashboardIndex();
    const site = index.sites?.find((s) => s.domain === decodedDomain);
    branch = site?.staging_branch ?? `staging/${decodedDomain}`;
  }

  const articlePath = buildArticlePath(decodedDomain, slug);

  await commitNetworkFiles(
    [{ path: articlePath, content }],
    `fix(content): edit article ${slug} for ${decodedDomain}`,
    branch,
  );

  // Dual-write to MongoDB (soft-fail)
  const parsed = matter(content);
  const fm = parsed.data;
  await upsertArticleMeta(decodedDomain, slug, branch, {
    title: fm.title,
    description: fm.description,
    status: fm.status,
    type: fm.type,
    publish_date: fm.publishDate ?? fm.publish_date,
    author: fm.author,
    tags: fm.tags,
    featured_image: fm.featuredImage ?? fm.featured_image,
    quality_score: fm.quality_score,
    videos: fm.videos,
    scripts: fm.scripts,
    source_url: fm.source_url,
  });

  return NextResponse.json({ status: "updated", slug, branch });
}
