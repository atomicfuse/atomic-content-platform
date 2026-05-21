import { NextRequest, NextResponse } from "next/server";
import { readDashboardIndex, readArticles } from "@/lib/github";
import { WORKER_STAGING_URL } from "@/lib/constants";
import type { ArticleEntry } from "@/types/dashboard";

export interface ReviewArticleDTO extends ArticleEntry {
  domain: string;
  stagingBaseUrl: string | null;
  branch: string | null;
}

export interface ReviewQueueResponse {
  items: ReviewArticleDTO[];
  total: number;
  page: number;
  pageSize: number;
  /** Domain-level article counts across ALL review articles (unfiltered). */
  domains: Array<{ domain: string; count: number }>;
}

const DEFAULT_PAGE_SIZE = 25;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const params = req.nextUrl.searchParams;
  const page = Math.max(0, parseInt(params.get("page") ?? "0", 10));
  const pageSize = Math.min(
    100,
    Math.max(1, parseInt(params.get("pageSize") ?? String(DEFAULT_PAGE_SIZE), 10)),
  );
  const domainFilter = params.get("domain") ?? "";
  const sort = params.get("sort") ?? "default"; // "default" | "newest" | "oldest"

  const index = await readDashboardIndex();
  const allReview: ReviewArticleDTO[] = [];

  await Promise.allSettled(
    index.sites.map(async (site) => {
      const branch = site.staging_branch ?? undefined;
      const stagingBaseUrl = site.staging_branch ? WORKER_STAGING_URL : null;
      const articles = await readArticles(site.domain, branch);
      for (const article of articles) {
        if (article.status !== "review") continue;
        allReview.push({
          ...article,
          domain: site.domain,
          stagingBaseUrl,
          branch: site.staging_branch ?? null,
        });
      }
    }),
  );

  // Build domain counts from the full (unfiltered) set
  const domainMap = new Map<string, number>();
  for (const a of allReview) {
    domainMap.set(a.domain, (domainMap.get(a.domain) ?? 0) + 1);
  }
  const domains = Array.from(domainMap.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([domain, count]) => ({ domain, count }));

  // Filter by domain
  let filtered = domainFilter
    ? allReview.filter((a) => a.domain === domainFilter)
    : allReview;

  // Sort
  if (sort === "newest" || sort === "oldest") {
    filtered = [...filtered].sort((a, b) => {
      const da = a.publishDate ? new Date(a.publishDate).getTime() : 0;
      const db = b.publishDate ? new Date(b.publishDate).getTime() : 0;
      return sort === "newest" ? db - da : da - db;
    });
  }

  // Paginate
  const total = filtered.length;
  const items = filtered.slice(page * pageSize, (page + 1) * pageSize);

  return NextResponse.json({
    items,
    total,
    page,
    pageSize,
    domains,
  } satisfies ReviewQueueResponse);
}
