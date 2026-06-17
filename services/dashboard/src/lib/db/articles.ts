import { getMongoDb } from "../mongo.js";
import { COLLECTIONS } from "./collections.js";

/** Frontmatter-only article metadata stored in MongoDB. */
export interface ArticleMeta {
  domain: string;
  slug: string;
  branch: string;
  title?: string;
  status?: string;
  quality_score?: number;
  featured_image?: string;
  image_alt?: string;
  publish_date?: string;
  tags?: string[];
  source_url?: string;
  videos?: unknown[];
  scripts?: unknown[];
  author?: string;
  type?: string;
  description?: string;
  score_breakdown?: Record<string, number>;
  reading_time?: number;
  updatedAt?: Date;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getArticlesMeta(
  domain: string,
  branch: string,
): Promise<ArticleMeta[]> {
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
  const db = await getMongoDb();
  return db
    .collection(COLLECTIONS.articles)
    .countDocuments({ domain, branch, status });
}

export async function countArticles(
  domain: string,
  branch: string,
): Promise<number> {
  const db = await getMongoDb();
  return db
    .collection(COLLECTIONS.articles)
    .countDocuments({ domain, branch });
}

// ---------------------------------------------------------------------------
// Writes (soft-fail: log warning, never throw)
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
