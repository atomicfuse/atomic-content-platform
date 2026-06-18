import { getMongoDb } from "../mongo.js";

const ARTICLES_COLLECTION = "articles";

export async function upsertArticleMeta(
  domain: string,
  slug: string,
  branch: string,
  frontmatter: Record<string, unknown>,
): Promise<void> {
  try {
    const db = await getMongoDb();
    await db.collection(ARTICLES_COLLECTION).updateOne(
      { domain, slug, branch },
      { $set: { ...frontmatter, domain, slug, branch, updatedAt: new Date() } },
      { upsert: true },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[db] upsertArticleMeta failed (${domain}/${slug}): ${msg}`);
  }
}

export async function upsertArticlesBatch(
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
    await db.collection(ARTICLES_COLLECTION).bulkWrite(ops);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[db] upsertArticlesBatch failed (${docs.length} docs): ${msg}`);
  }
}

export async function deleteArticlesForSiteBranch(
  domain: string,
  branch: string,
): Promise<void> {
  try {
    const db = await getMongoDb();
    await db.collection(ARTICLES_COLLECTION).deleteMany({ domain, branch });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[db] deleteArticlesForSiteBranch failed (${domain}@${branch}): ${msg}`);
  }
}
