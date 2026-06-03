import { describe, it, expect, vi, beforeEach } from "vitest";
import { readSiteBrief } from "../lib/site-brief.js";

vi.mock("../lib/github.js", () => ({
  readFile: vi.fn(),
}));

import { readFile } from "../lib/github.js";

const mockOctokit = {} as unknown as Parameters<typeof readSiteBrief>[0];

function siteYaml(extra: string): string {
  return `domain: testsite
site_name: Test
${extra}
brief:
  audience: General
  tone: friendly
  article_types: { standard: 100 }
  topics: []
  seo_keywords_focus: []
  content_guidelines: []
  review_percentage: 0
  schedule:
    articles_per_day: 1
    preferred_days: [Monday]
    preferred_time: "10:00"
`;
}

describe("readSiteBrief bundle shim", () => {
  beforeEach(() => vi.mocked(readFile).mockReset());

  it("promotes top-level bundle_id into brief.bundle_ids when neither brief field is set", async () => {
    vi.mocked(readFile).mockResolvedValue(siteYaml("bundle_id: top-1"));
    const { brief } = await readSiteBrief(mockOctokit, "owner/repo", "testsite");
    expect(brief.bundle_ids).toEqual(["top-1"]);
  });

  it("promotes brief.bundle_id (singular) into brief.bundle_ids", async () => {
    vi.mocked(readFile).mockResolvedValue(
      siteYaml("brief_extra: noop").replace(
        "brief:",
        "brief:\n  bundle_id: brief-1",
      ),
    );
    const { brief } = await readSiteBrief(mockOctokit, "owner/repo", "testsite");
    expect(brief.bundle_ids).toEqual(["brief-1"]);
  });

  it("merges brief.bundle_id and top-level bundle_id, deduped, brief first", async () => {
    vi.mocked(readFile).mockResolvedValue(
      siteYaml("bundle_id: top-1").replace(
        "brief:",
        "brief:\n  bundle_id: brief-1",
      ),
    );
    const { brief } = await readSiteBrief(mockOctokit, "owner/repo", "testsite");
    expect(brief.bundle_ids).toEqual(["brief-1", "top-1"]);
  });

  it("leaves bundle_ids alone when already populated", async () => {
    vi.mocked(readFile).mockResolvedValue(
      siteYaml("bundle_id: top-1").replace(
        "brief:",
        "brief:\n  bundle_ids: [a, b]\n  bundle_id: brief-1",
      ),
    );
    const { brief } = await readSiteBrief(mockOctokit, "owner/repo", "testsite");
    expect(brief.bundle_ids).toEqual(["a", "b"]);
  });

  it("leaves bundle_ids unset when no legacy fields exist", async () => {
    vi.mocked(readFile).mockResolvedValue(siteYaml(""));
    const { brief } = await readSiteBrief(mockOctokit, "owner/repo", "testsite");
    expect(brief.bundle_ids).toBeUndefined();
  });
});
