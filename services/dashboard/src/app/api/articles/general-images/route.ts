import { NextRequest, NextResponse } from "next/server";
import { readDashboardIndex } from "@/lib/github";
import { readArticleIndexFromKV } from "@/lib/kv-api";
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

export interface SiteBreakdownEntry {
  domain: string;
  count: number;
}

export interface GeneralImageArticlesResponse {
  items: GeneralImageArticle[];
  total: number;
  page: number;
  pageSize: number;
  siteBreakdown: SiteBreakdownEntry[];
}

const DEFAULT_PAGE_SIZE = 10;
const CACHE_TTL_MS = 60_000; // 60 seconds

let cachedResults: { data: GeneralImageArticle[]; ts: number } | null = null;

async function loadGeneralImageArticles(): Promise<GeneralImageArticle[]> {
  const now = Date.now();
  if (cachedResults && now - cachedResults.ts < CACHE_TTL_MS) {
    return cachedResults.data;
  }

  const index = await readDashboardIndex();
  const activeSites = index.sites.filter(
    (s) =>
      s.status === "Staging" ||
      s.status === "Ready" ||
      s.status === "Live",
  );

  const results: GeneralImageArticle[] = [];

  await Promise.allSettled(
    activeSites.map(async (site) => {
      const kvNamespace = site.status === "Live" ? "production" : "staging";
      const articles = await readArticleIndexFromKV(site.domain, kvNamespace);
      if (!articles) return;
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

  cachedResults = { data: results, ts: now };
  return results;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const params = req.nextUrl.searchParams;
    const page = Math.max(0, parseInt(params.get("page") ?? "0", 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(params.get("pageSize") ?? String(DEFAULT_PAGE_SIZE), 10)));
    const search = (params.get("search") ?? "").toLowerCase();

    const results = await loadGeneralImageArticles();

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

    // Site breakdown (from full unfiltered results)
    const countsByDomain = new Map<string, number>();
    for (const a of results) {
      countsByDomain.set(a.domain, (countsByDomain.get(a.domain) ?? 0) + 1);
    }
    const siteBreakdown: SiteBreakdownEntry[] = Array.from(countsByDomain.entries())
      .map(([domain, count]) => ({ domain, count }))
      .sort((a, b) => a.domain.localeCompare(b.domain));

    return NextResponse.json({ items, total, page, pageSize, siteBreakdown } satisfies GeneralImageArticlesResponse);
  } catch (err) {
    console.error("[general-images] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 },
    );
  }
}
