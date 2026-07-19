import { getMongoDb } from "../mongo";
import { COLLECTIONS } from "./collections";
import type { ArticleEntry } from "@/types/dashboard";

function useMongoReads(): boolean {
  return process.env.USE_MONGO_READS === "true";
}

/** Legacy auto-publish runs upserted placeholder files (articles/.gitkeep)
 *  into Mongo as articles with dot-prefixed slugs — reads must exclude them. */
const NON_PLACEHOLDER_SLUG = { $not: /^\./ };

/** Frontmatter-only article metadata stored in MongoDB.
 *  MongoDB documents contain camelCase fields (written directly from
 *  frontmatter by the content-pipeline and backfill scripts). The
 *  interface declares both forms so TypeScript is satisfied regardless
 *  of which key name appears in a given document. */
export interface ArticleMeta {
  domain: string;
  slug: string;
  branch: string;
  title?: string;
  status?: string;
  quality_score?: number;
  featured_image?: string;
  featuredImage?: string;
  image_alt?: string;
  publish_date?: string;
  publishDate?: string;
  tags?: string[];
  source_url?: string;
  videos?: unknown[];
  scripts?: unknown[];
  author?: string;
  type?: string;
  description?: string;
  score_breakdown?: Record<string, number>;
  scoreBreakdown?: Record<string, number>;
  reading_time?: number;
  updatedAt?: Date;
}

/** Map MongoDB ArticleMeta to dashboard ArticleEntry.
 *  Handles both camelCase (from frontmatter) and snake_case field names. */
function toArticleEntry(doc: ArticleMeta): ArticleEntry {
  return {
    slug: doc.slug,
    title: doc.title ?? doc.slug,
    type: doc.type ?? "standard",
    status: doc.status ?? "draft",
    publishDate: doc.publishDate ?? doc.publish_date ?? "",
    featuredImage: doc.featuredImage ?? doc.featured_image ?? undefined,
    score: doc.quality_score,
    scoreBreakdown: (doc.scoreBreakdown ?? doc.score_breakdown) as ArticleEntry["scoreBreakdown"],
    qualityNote: undefined,
    reviewerNotes: undefined,
  };
}

// ---------------------------------------------------------------------------
// Reads (feature-flagged: USE_MONGO_READS → MongoDB, else Git fallback)
// ---------------------------------------------------------------------------

export async function getArticlesMeta(
  domain: string,
  branch: string,
): Promise<ArticleMeta[]> {
  if (!useMongoReads()) {
    const { readArticles } = await import("../github");
    const entries = await readArticles(domain, branch);
    // Map ArticleEntry back to ArticleMeta shape for callers expecting it
    return entries.map((e) => ({
      domain,
      slug: e.slug,
      branch,
      title: e.title,
      status: e.status,
      quality_score: e.score,
      type: e.type,
      publish_date: e.publishDate,
      featured_image: e.featuredImage,
      score_breakdown: e.scoreBreakdown as Record<string, number> | undefined,
    }));
  }
  const db = await getMongoDb();
  return db
    .collection<ArticleMeta>(COLLECTIONS.articles)
    .find({ domain, branch })
    .sort({ slug: 1 })
    .toArray();
}

export async function getArticleMeta(
  domain: string,
  slug: string,
  branch: string,
): Promise<ArticleMeta | null> {
  if (!useMongoReads()) {
    const { readArticles } = await import("../github");
    const entries = await readArticles(domain, branch);
    const entry = entries.find((e) => e.slug === slug);
    if (!entry) return null;
    return {
      domain,
      slug: entry.slug,
      branch,
      title: entry.title,
      status: entry.status,
      quality_score: entry.score,
      type: entry.type,
      publish_date: entry.publishDate,
      featured_image: entry.featuredImage,
      score_breakdown: entry.scoreBreakdown as Record<string, number> | undefined,
    };
  }
  const db = await getMongoDb();
  return db
    .collection<ArticleMeta>(COLLECTIONS.articles)
    .findOne({ domain, slug, branch });
}

export async function countArticlesByStatus(
  domain: string,
  branch: string,
  status: string,
): Promise<number> {
  if (!useMongoReads()) {
    const { readArticles } = await import("../github");
    const entries = await readArticles(domain, branch);
    return entries.filter((e) => e.status === status).length;
  }
  const db = await getMongoDb();
  return db
    .collection(COLLECTIONS.articles)
    .countDocuments({ domain, branch, status });
}

export async function countArticles(
  domain: string,
  branch: string,
): Promise<number> {
  if (!useMongoReads()) {
    const { countArticles: gitCountArticles } = await import("../github");
    return gitCountArticles(domain, branch);
  }
  const db = await getMongoDb();
  return db
    .collection(COLLECTIONS.articles)
    .countDocuments({ domain, branch });
}

/**
 * Read articles for a site, returning dashboard-friendly ArticleEntry[].
 * When USE_MONGO_READS is true, reads from MongoDB and maps to camelCase.
 * When false, falls back to Git via readArticles (or KV via readArticlesWithKVFallback).
 *
 * Auto-publish re-keys article docs from the staging branch to "main" and
 * deletes the staging copies (see content-pipeline autoPublishSite), so a
 * site's article set is the union of both branches, deduped by slug with the
 * staging doc winning (it is the newer working copy).
 */
export async function readArticlesFromDb(
  domain: string,
  branch?: string,
): Promise<ArticleEntry[]> {
  if (!useMongoReads()) {
    const { readArticles } = await import("../github");
    const { readArticlesWithKVFallback } = await import("../kv-api");
    return readArticlesWithKVFallback(domain, branch, readArticles);
  }
  const effectiveBranch = branch ?? "main";
  const db = await getMongoDb();
  const branchFilter =
    effectiveBranch === "main" ? "main" : { $in: [effectiveBranch, "main"] };
  const docs = await db
    .collection<ArticleMeta>(COLLECTIONS.articles)
    .find({ domain, branch: branchFilter, slug: NON_PLACEHOLDER_SLUG })
    .sort({ slug: 1 })
    .toArray();
  const bySlug = new Map<string, ArticleMeta>();
  for (const doc of docs) {
    if (!bySlug.has(doc.slug) || doc.branch === effectiveBranch) {
      bySlug.set(doc.slug, doc);
    }
  }
  return [...bySlug.values()].map(toArticleEntry);
}

/**
 * Count articles across multiple sites. Returns domain → count map.
 * When USE_MONGO_READS is true, uses a single MongoDB aggregation.
 * When false, falls back to the Git-based countArticlesForSites.
 */
export async function countArticlesForSites(
  sites: Array<{ domain: string; staging_branch: string | null }>,
): Promise<Record<string, number>> {
  if (!useMongoReads()) {
    const { countArticlesForSites: gitCount } = await import("../github");
    return gitCount(sites);
  }
  if (sites.length === 0) return {};
  const db = await getMongoDb();
  // A site's articles live under its staging branch between publishes and
  // under "main" once auto-publish re-keys them — count the union of both,
  // distinct by slug so an article present on both branches counts once.
  const branchFilters = sites.map((s) => ({
    domain: s.domain,
    branch: { $in: s.staging_branch ? [s.staging_branch, "main"] : ["main"] },
  }));

  const pipeline = [
    { $match: { slug: NON_PLACEHOLDER_SLUG, $or: branchFilters } },
    { $group: { _id: "$domain", slugs: { $addToSet: "$slug" } } },
    { $project: { count: { $size: "$slugs" } } },
  ];
  const results = await db.collection(COLLECTIONS.articles).aggregate(pipeline).toArray();
  const counts: Record<string, number> = {};
  for (const r of results) {
    counts[r._id as string] = r.count as number;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Writes (soft-fail: log warning, never throw)
// These ALWAYS write to MongoDB regardless of the feature flag.
// ---------------------------------------------------------------------------

export async function upsertArticleMeta(
  domain: string,
  slug: string,
  branch: string,
  frontmatter: Record<string, unknown>,
): Promise<void> {
  try {
    const db = await getMongoDb();
    await db.collection(COLLECTIONS.articles).updateOne(
      { domain, slug, branch },
      { $set: { ...frontmatter, domain, slug, branch, updatedAt: new Date() } },
      { upsert: true },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[db] upsertArticleMeta failed (${domain}/${slug}): ${msg}`);
  }
}

export async function upsertArticlesMeta(
  docs: Array<{ domain: string; slug: string; branch: string; frontmatter: Record<string, unknown> }>,
): Promise<void> {
  if (docs.length === 0) return;
  try {
    const db = await getMongoDb();
    const ops = docs.map((d) => ({
      updateOne: {
        filter: { domain: d.domain, slug: d.slug, branch: d.branch },
        update: {
          $set: { ...d.frontmatter, domain: d.domain, slug: d.slug, branch: d.branch, updatedAt: new Date() },
        },
        upsert: true,
      },
    }));
    await db.collection(COLLECTIONS.articles).bulkWrite(ops);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[db] upsertArticlesMeta failed (${docs.length} docs): ${msg}`);
  }
}

export async function deleteArticleMeta(
  domain: string,
  slug: string,
  branch: string,
): Promise<void> {
  try {
    const db = await getMongoDb();
    await db.collection(COLLECTIONS.articles).deleteOne({ domain, slug, branch });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[db] deleteArticleMeta failed (${domain}/${slug}): ${msg}`);
  }
}

export async function deleteArticlesMeta(
  domain: string,
  slugs: string[],
  branch: string,
): Promise<void> {
  if (slugs.length === 0) return;
  try {
    const db = await getMongoDb();
    await db.collection(COLLECTIONS.articles).deleteMany({
      domain,
      branch,
      slug: { $in: slugs },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[db] deleteArticlesMeta failed (${domain}, ${slugs.length} slugs): ${msg}`);
  }
}

export async function deleteArticlesForSite(domain: string): Promise<void> {
  try {
    const db = await getMongoDb();
    await db.collection(COLLECTIONS.articles).deleteMany({ domain });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[db] deleteArticlesForSite failed (${domain}): ${msg}`);
  }
}

export async function deleteArticlesForSiteBranch(
  domain: string,
  branch: string,
): Promise<void> {
  try {
    const db = await getMongoDb();
    await db.collection(COLLECTIONS.articles).deleteMany({ domain, branch });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[db] deleteArticlesForSiteBranch failed (${domain}@${branch}): ${msg}`);
  }
}

/**
 * Copy all articles from one branch to another (used by auto-publish).
 * Reads all articles for domain+sourceBranch, inserts copies with targetBranch.
 */
export async function copyArticlesToBranch(
  domain: string,
  sourceBranch: string,
  targetBranch: string,
): Promise<void> {
  try {
    const db = await getMongoDb();
    const coll = db.collection(COLLECTIONS.articles);
    const docs = await coll.find({ domain, branch: sourceBranch }).toArray();
    if (docs.length === 0) return;

    const ops = docs.map((doc) => {
      const { _id, ...rest } = doc;
      return {
        updateOne: {
          filter: { domain, slug: doc.slug, branch: targetBranch },
          update: {
            $set: {
              ...rest,
              branch: targetBranch,
              updatedAt: new Date(),
            },
          },
          upsert: true,
        },
      };
    });
    await coll.bulkWrite(ops);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[db] copyArticlesToBranch failed (${domain}): ${msg}`);
  }
}
