import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const yamls: Record<string, string> = {};
vi.mock("@/lib/db/site-configs", () => ({ listSiteConfigs: vi.fn(async () => []) }));
vi.mock("@/lib/db/dashboard-index", () => ({ getDashboardIndex: vi.fn(async () => ({ sites: [{ domain: "dailybuzzalley" }, { domain: "scoopella" }] })) }));
vi.mock("@/lib/github", () => ({ readFileContent: vi.fn(async (p: string, ref: string) => yamls[`${ref}:${p}`] ?? null) }));

import { readFileContent } from "@/lib/github";
import { invalidateConnectedSites, withSites } from "../with-sites";
import type { AuthorRecord } from "../types";

const FIONA = { id: "fiona-galbraith", name: "Fiona Galbraith", tagline: "", bio: "", beats: [], verticals: [], portrait: null, links: {}, exclusive_sites: [], created_at: "", updated_at: "" } as AuthorRecord;

beforeEach(() => {
  vi.stubEnv("USE_MONGO_READS", "false");
  invalidateConnectedSites();
  vi.mocked(readFileContent).mockClear();
  yamls["staging/dailybuzzalley:sites/dailybuzzalley/site.yaml"] = "domain: dailybuzzalley\nauthors:\n  - id: fiona-galbraith\n    topics: [Pop Culture Pulse]\n";
});
afterEach(() => vi.unstubAllEnvs());

describe("withSites without Mongo reads (local grid dev)", () => {
  it("shows the sites an author writes for, read from git", async () => {
    const [out] = await withSites([FIONA]);
    expect(out!.sites).toEqual([{ site: "dailybuzzalley", topics: ["Pop Culture Pulse"] }]);
  });

  it("reuses the read for a minute, and a site save makes the next read fresh", async () => {
    await withSites([FIONA]);
    const reads = vi.mocked(readFileContent).mock.calls.length;
    await withSites([FIONA]);
    expect(vi.mocked(readFileContent).mock.calls.length).toBe(reads);
    invalidateConnectedSites();
    await withSites([FIONA]);
    expect(vi.mocked(readFileContent).mock.calls.length).toBeGreaterThan(reads);
  });
});
