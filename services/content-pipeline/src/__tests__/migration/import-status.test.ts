import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  writeBatchMeta,
  writeSiteStatus,
  readBatchStatus,
  writeArticleImportProgress,
  readArticleImportProgress,
  readActiveImport,
  BATCH_KEY_PREFIX,
  BATCH_TTL_SECONDS,
  ARTICLE_IMPORT_KEY_PREFIX,
  ARTICLE_IMPORT_TTL_SECONDS,
} from "../../agents/migration/import-status.js";

// Minimal Redis mock
function createRedisMock(): Record<string, unknown> {
  const store = new Map<string, Map<string, string>>();
  const stringStore = new Map<string, string>();

  return {
    hset: vi.fn(async (key: string, field: string, value: string) => {
      if (!store.has(key)) store.set(key, new Map());
      store.get(key)!.set(field, value);
      return 1;
    }),
    hget: vi.fn(async (key: string, field: string) => {
      return store.get(key)?.get(field) ?? null;
    }),
    hgetall: vi.fn(async (key: string) => {
      const map = store.get(key);
      if (!map || map.size === 0) return {};
      const obj: Record<string, string> = {};
      for (const [k, v] of map) obj[k] = v;
      return obj;
    }),
    get: vi.fn(async (key: string) => stringStore.get(key) ?? null),
    set: vi.fn(async (key: string, value: string, ..._args: unknown[]) => {
      stringStore.set(key, value);
      return "OK";
    }),
    expire: vi.fn(async () => 1),
    _store: store,
    _stringStore: stringStore,
  };
}

describe("import-status", () => {
  let redis: ReturnType<typeof createRedisMock>;

  beforeEach(() => {
    redis = createRedisMock();
  });

  it("writeBatchMeta stores meta and sets TTL", async () => {
    await writeBatchMeta(redis as never, "batch-1", { total: 5, status: "pending", createdAt: "2026-05-24T00:00:00Z" });

    expect(redis.hset).toHaveBeenCalledWith(
      `${BATCH_KEY_PREFIX}batch-1`,
      "meta",
      expect.any(String),
    );
    expect(redis.expire).toHaveBeenCalledWith(
      `${BATCH_KEY_PREFIX}batch-1`,
      BATCH_TTL_SECONDS,
    );
  });

  it("writeSiteStatus stores per-site status", async () => {
    await writeSiteStatus(redis as never, "batch-1", "mysite", {
      status: "running",
      phase: "resolving-categories",
    });

    expect(redis.hset).toHaveBeenCalledWith(
      `${BATCH_KEY_PREFIX}batch-1`,
      "site:mysite",
      expect.stringContaining("resolving-categories"),
    );
  });

  it("readBatchStatus aggregates meta and site statuses", async () => {
    await writeBatchMeta(redis as never, "batch-1", { total: 2, status: "running", createdAt: "2026-05-24T00:00:00Z" });
    await writeSiteStatus(redis as never, "batch-1", "site-a", { status: "complete", previewUrl: "https://example.com" });
    await writeSiteStatus(redis as never, "batch-1", "site-b", { status: "error", error: "branch creation failed" });

    const result = await readBatchStatus(redis as never, "batch-1");

    expect(result).not.toBeNull();
    expect(result!.total).toBe(2);
    expect(result!.status).toBe("running");
    expect(result!.sites).toHaveLength(2);
    expect(result!.sites.find((s) => s.siteId === "site-a")?.status).toBe("complete");
    expect(result!.sites.find((s) => s.siteId === "site-b")?.error).toBe("branch creation failed");
  });

  it("readBatchStatus returns null for unknown batch", async () => {
    const result = await readBatchStatus(redis as never, "nonexistent");
    expect(result).toBeNull();
  });

  describe("article import status", () => {
    it("writeArticleImportProgress stores progress with correct key", async () => {
      const progress = {
        jobId: "job-1",
        site: "example.com",
        status: "running" as const,
        phase: "fetching",
        totalArticles: 10,
        processedArticles: 3,
        successfulArticles: 2,
        failedArticles: 1,
      };
      await writeArticleImportProgress(redis as never, "job-1", progress);
      expect(redis.set).toHaveBeenCalledWith(
        `${ARTICLE_IMPORT_KEY_PREFIX}job-1`,
        expect.any(String),
        "EX",
        ARTICLE_IMPORT_TTL_SECONDS,
      );
    });

    it("readArticleImportProgress returns stored progress", async () => {
      const progress = {
        jobId: "job-1",
        site: "example.com",
        status: "running" as const,
        phase: "committing",
        totalArticles: 10,
        processedArticles: 5,
        successfulArticles: 4,
        failedArticles: 1,
      };
      await writeArticleImportProgress(redis as never, "job-1", progress);
      const result = await readArticleImportProgress(redis as never, "job-1");
      expect(result).toEqual(progress);
    });

    it("readArticleImportProgress returns null for unknown job", async () => {
      const result = await readArticleImportProgress(redis as never, "nonexistent");
      expect(result).toBeNull();
    });

    it("readActiveImport returns jobId and progress when lock exists", async () => {
      (redis as any)._stringStore.set("article-import-active:example.com", "job-1");
      const progress = {
        jobId: "job-1",
        site: "example.com",
        status: "running" as const,
        phase: "fetching",
        totalArticles: 10,
        processedArticles: 3,
        successfulArticles: 2,
        failedArticles: 1,
      };
      await writeArticleImportProgress(redis as never, "job-1", progress);

      const result = await readActiveImport(redis as never, "example.com");
      expect(result).not.toBeNull();
      expect(result!.jobId).toBe("job-1");
      expect(result!.progress!.status).toBe("running");
    });

    it("readActiveImport returns null when no lock exists", async () => {
      const result = await readActiveImport(redis as never, "example.com");
      expect(result).toBeNull();
    });

    it("readActiveImport returns jobId with null progress when lock exists but progress expired", async () => {
      (redis as any)._stringStore.set("article-import-active:example.com", "job-1");

      const result = await readActiveImport(redis as never, "example.com");
      expect(result).not.toBeNull();
      expect(result!.jobId).toBe("job-1");
      expect(result!.progress).toBeNull();
    });
  });
});
