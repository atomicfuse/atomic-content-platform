import { NextRequest, NextResponse } from "next/server";
import { readDashboardIndex, readArticles } from "@/lib/github";
import { isGeneralImage } from "@/lib/general-image-utils";

export interface GeneralImageArticle {
  domain: string;
  siteName: string;
  slug: string;
  title: string;
  featuredImage?: string;
  publishDate: string;
  status: string;
  stagingBranch: string | null;
}

export interface GeneralImageArticlesResponse {
  items: GeneralImageArticle[];
  total: number;
  page: number;
  pageSize: number;
}

const DEFAULT_PAGE_SIZE = 25;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const params = req.nextUrl.searchParams;
  const page = Math.max(0, parseInt(params.get("page") ?? "0", 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(params.get("pageSize") ?? String(DEFAULT_PAGE_SIZE), 10)));
  const search = (params.get("search") ?? "").toLowerCase();

  const index = await readDashboardIndex();
  const activeSites = index.sites.filter(
    (s) =>
      s.status === "Staging" ||
      s.status === "Ready" ||
      s.status === "Live" ||
      s.status === "WordPress",
  );

  const results: GeneralImageArticle[] = [];

  await Promise.allSettled(
    activeSites.map(async (site) => {
      const branch = site.staging_branch ?? undefined;
      const articles = await readArticles(site.domain, branch);
      for (const a of articles) {
        if (isGeneralImage(a.featuredImage, site.domain)) {
          results.push({
            domain: site.domain,
            siteName: site.domain,
            slug: a.slug,
            title: a.title,
            featuredImage: a.featuredImage,
            publishDate: a.publishDate,
            status: a.status,
            stagingBranch: site.staging_branch ?? null,
          });
        }
      }
    }),
  );

  results.sort(
    (a, b) =>
      new Date(b.publishDate).getTime() - new Date(a.publishDate).getTime(),
  );

  // Server-side search filter
  const filtered = search
    ? results.filter(
        (a) =>
          a.title.toLowerCase().includes(search) ||
          a.domain.toLowerCase().includes(search),
      )
    : results;

  // Paginate
  const total = filtered.length;
  const items = filtered.slice(page * pageSize, (page + 1) * pageSize);

  return NextResponse.json({ items, total, page, pageSize } satisfies GeneralImageArticlesResponse);
}
