import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/dashboard-index", () => ({
  getDashboardIndex: vi.fn(),
}));
vi.mock("@/lib/db/site-configs", () => ({
  getSiteConfig: vi.fn(),
  upsertSiteConfig: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/github", () => ({
  commitSiteFiles: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { revalidatePath } from "next/cache";
import { migrateSiteToPerTopic } from "../per-topic-migration";
import { commitSiteFiles } from "@/lib/github";
import { getDashboardIndex } from "@/lib/db/dashboard-index";
import { getSiteConfig, upsertSiteConfig } from "@/lib/db/site-configs";

const SITE_INDEX = {
  sites: [{ domain: "travelnights", staging_branch: "staging/travelnights", status: "Live" }],
};

const LEGACY_CONFIG = {
  domain: "travelnights",
  site_name: "Travel Nights",
  brief: {
    audience: "Travelers",
    tone: "informative",
    bundle_ids: ["b1", "b2"],
    category_ids: ["cat-1"],
    tag_ids: ["tag-1"],
    topics: ["Destinations", "Wine & Beer"],
  },
};

const TOPICS_V2 = [
  {
    name: "Destinations",
    source: { type: "filter" as const, category_ids: ["cat-travel"], tag_ids: ["tag-dest"] },
    schedule: { articles_per_week: 3, preferred_days: ["Monday", "Wednesday", "Friday"] },
  },
  {
    name: "Wine & Beer",
    source: { type: "filter" as const, category_ids: ["cat-alc"], tag_ids: ["tag-wine"] },
    schedule: { articles_per_week: 1, preferred_days: ["Tuesday"] },
  },
];

describe("migrateSiteToPerTopic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDashboardIndex).mockResolvedValue(SITE_INDEX as unknown as Awaited<ReturnType<typeof getDashboardIndex>>);
    vi.mocked(getSiteConfig).mockResolvedValue(JSON.parse(JSON.stringify(LEGACY_CONFIG)));
  });

  it("writes topics_v2 + theme and strips legacy fields", async () => {
    const result = await migrateSiteToPerTopic({
      domain: "travelnights",
      theme: "Travel and eating while traveling",
      topics_v2: TOPICS_V2,
      deleteOrphanBundleIds: [],
    });
    expect(result.status).toBe("ok");

    const commitCall = vi.mocked(commitSiteFiles).mock.calls[0]!;
    const files = commitCall[1] as Array<{ path: string; content: string }>;
    expect(files[0]!.path).toBe("sites/travelnights/site.yaml");

    const { parse: parseYaml } = await import("yaml");
    const parsed = parseYaml(files[0]!.content) as { brief: Record<string, unknown> };
    expect(parsed.brief.theme).toBe("Travel and eating while traveling");
    expect(parsed.brief.topics_v2).toEqual(TOPICS_V2);
    // Legacy `topics` array must mirror topic names — the live nav menu and
    // category routing read it.
    expect(parsed.brief.topics).toEqual(["Destinations", "Wine & Beer"]);
    expect(parsed.brief.bundle_ids).toBeUndefined();
    expect(parsed.brief.category_ids).toBeUndefined();
    expect(parsed.brief.tag_ids).toBeUndefined();
  });

  it("dual-writes the migrated config to MongoDB and revalidates the site page", async () => {
    const result = await migrateSiteToPerTopic({
      domain: "travelnights",
      theme: "Travel and eating while traveling",
      topics_v2: TOPICS_V2,
      deleteOrphanBundleIds: [],
    });
    expect(result.status).toBe("ok");

    // The dashboard reads config from MongoDB (USE_MONGO_READS) — a git-only
    // commit leaves the UI stale forever. The action must mirror the write.
    expect(upsertSiteConfig).toHaveBeenCalledTimes(1);
    const [domain, config] = vi.mocked(upsertSiteConfig).mock.calls[0]!;
    expect(domain).toBe("travelnights");
    const brief = (config as { brief: Record<string, unknown> }).brief;
    expect(brief.topics_v2).toEqual(TOPICS_V2);
    expect(brief.bundle_ids).toBeUndefined();

    expect(revalidatePath).toHaveBeenCalledWith("/sites/travelnights");
    expect(revalidatePath).toHaveBeenCalledWith("/");
  });

  it("does not dual-write when the git commit fails", async () => {
    vi.mocked(commitSiteFiles).mockRejectedValueOnce(new Error("git down"));
    await expect(
      migrateSiteToPerTopic({
        domain: "travelnights",
        theme: "Travel",
        topics_v2: TOPICS_V2,
        deleteOrphanBundleIds: [],
      }),
    ).rejects.toThrow("git down");
    expect(upsertSiteConfig).not.toHaveBeenCalled();
  });

  it("deletes orphan bundles on the aggregator (best-effort)", async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200 } as Response);

    const result = await migrateSiteToPerTopic({
      domain: "travelnights",
      theme: "Travel and food",
      topics_v2: TOPICS_V2,
      deleteOrphanBundleIds: ["b1", "b2"],
    });

    expect(result.status).toBe("ok");
    expect(result.bundlesDeleted).toBe(2);
    expect(result.bundlesFailedToDelete).toEqual([]);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("counts 404 as a successful delete (bundle already gone)", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404 } as Response);

    const result = await migrateSiteToPerTopic({
      domain: "travelnights",
      theme: "Travel and food",
      topics_v2: TOPICS_V2,
      deleteOrphanBundleIds: ["b-gone"],
    });

    expect(result.status).toBe("ok");
    expect(result.bundlesDeleted).toBe(1);
  });

  it("tracks bundles that failed to delete", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 } as Response);
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 } as Response);

    const result = await migrateSiteToPerTopic({
      domain: "travelnights",
      theme: "Travel and food",
      topics_v2: TOPICS_V2,
      deleteOrphanBundleIds: ["b1", "b-fail"],
    });

    expect(result.status).toBe("ok");
    expect(result.bundlesDeleted).toBe(1);
    expect(result.bundlesFailedToDelete).toEqual(["b-fail"]);
  });

  it("rejects when theme is empty", async () => {
    const result = await migrateSiteToPerTopic({
      domain: "travelnights",
      theme: "   ",
      topics_v2: TOPICS_V2,
      deleteOrphanBundleIds: [],
    });
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/Theme is required/);
  });

  it("rejects when topics_v2 is empty", async () => {
    const result = await migrateSiteToPerTopic({
      domain: "travelnights",
      theme: "Travel",
      topics_v2: [],
      deleteOrphanBundleIds: [],
    });
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/at least one topic/i);
  });
});
