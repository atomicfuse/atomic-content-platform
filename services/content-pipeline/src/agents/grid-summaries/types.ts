/** Structural subset of the site-worker's GridPoolResponse (the pipeline does not depend on shared-types). */
export interface PoolItemLike {
  site: string;
  slug: string;
  title: string;
}

export interface PoolLike {
  siteId: string;
  storyMode: "excerpt" | "ai_summary";
  items: PoolItemLike[];
}

/** Structural subset of the KV ArticleRecord. */
export interface ArticleRecordLike {
  frontmatter: { title?: string; status?: string };
  body: string;
}
