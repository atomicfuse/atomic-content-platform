import { NextResponse } from "next/server";
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

export async function GET(): Promise<NextResponse> {
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

  return NextResponse.json(results);
}
