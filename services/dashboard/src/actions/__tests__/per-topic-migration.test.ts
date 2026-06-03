import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/github", () => ({
  commitSiteFiles: vi.fn().mockResolvedValue(undefined),
  readDashboardIndex: vi.fn(),
  readSiteConfig: vi.fn(),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { migrateSiteToPerTopic } from "../per-topic-migration";
import { commitSiteFiles, readDashboardIndex, readSiteConfig } from "@/lib/github";

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
    vi.mocked(readDashboardIndex).mockResolvedValue(SITE_INDEX as unknown as Awaited<ReturnType<typeof readDashboardIndex>>);
    vi.mocked(readSiteConfig).mockResolvedValue(JSON.parse(JSON.stringify(LEGACY_CONFIG)));
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
    expect(parsed.brief.bundle_ids).toBeUndefined();
    expect(parsed.brief.category_ids).toBeUndefined();
    expect(parsed.brief.tag_ids).toBeUndefined();
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
