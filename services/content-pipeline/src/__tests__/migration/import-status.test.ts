import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  writeBatchMeta,
  writeSiteStatus,
  readBatchStatus,
  BATCH_KEY_PREFIX,
  BATCH_TTL_SECONDS,
} from "../../agents/migration/import-status.js";

// Minimal Redis mock
function createRedisMock(): Record<string, unknown> {
  const store = new Map<string, Map<string, string>>();

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
    expire: vi.fn(async () => 1),
    _store: store,
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
});
