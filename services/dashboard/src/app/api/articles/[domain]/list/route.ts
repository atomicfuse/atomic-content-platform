import { NextRequest, NextResponse } from "next/server";
import { readArticles, readDashboardIndex } from "@/lib/github";

interface RouteParams {
  params: Promise<{ domain: string }>;
}

export async function GET(
  _req: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  const { domain } = await params;

  try {
    const index = await readDashboardIndex();
    const entry = index.sites.find((s) => s.domain === domain);
    const branch = entry?.staging_branch ?? `staging/${domain}`;

    const articles = await readArticles(domain, branch);

    return NextResponse.json({
      articles: articles.map((a) => ({
        slug: a.slug,
        title: a.title,
        status: a.status ?? "draft",
        featuredImage: a.featuredImage,
      })),
    });
  } catch (err) {
    console.error(`[articles/list] Error loading articles for ${domain}:`, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load articles" },
      { status: 500 },
    );
  }
}
