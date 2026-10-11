import { beforeEach, describe, expect, it, vi } from "vitest";

const files = new Map<string, string>();
const commits: Array<{ files: Array<{ path: string; content: string | Buffer }>; message: string }> = [];
vi.mock("@/lib/github", () => ({
  readFileContent: vi.fn(async (path: string) => files.get(path) ?? null),
  commitNetworkFiles: vi.fn(async (f: Array<{ path: string; content: string | Buffer }>, message: string) => {
    commits.push({ files: f, message });
    for (const x of f) files.set(x.path, String(x.content));
  }),
}));

import { readSimilarwebStatus, readSimilarwebStatuses, SIMILARWEB_FILE, upsertSimilarwebStatuses } from "../store";
import type { SimilarwebStatus } from "../types";

const st = (site: string, has_rank: boolean, global_rank: number | null = null): SimilarwebStatus =>
  ({ site, domain: `${site}.com`, has_rank, global_rank, monthly_visits: null, checked_at: "2026-10-11T08:00:00.000Z", source: "manual" });

describe("Similarweb store (network repo similarweb.yaml on main)", () => {
  beforeEach(() => { files.clear(); commits.length = 0; });

  it("no file yet → no statuses", async () => {
    expect(await readSimilarwebStatuses()).toEqual({});
    expect(await readSimilarwebStatus("x")).toBeNull();
  });

  it("an import merges into the file (other sites keep their result) in one commit", async () => {
    await upsertSimilarwebStatuses([st("a", true, 10), st("b", false)]);
    await upsertSimilarwebStatuses([st("b", true, 5)]);
    expect(commits).toHaveLength(2);
    expect(commits[1]!.files[0]!.path).toBe(SIMILARWEB_FILE);
    const all = await readSimilarwebStatuses();
    expect(all.a).toMatchObject({ has_rank: true, global_rank: 10 });
    expect(all.b).toMatchObject({ has_rank: true, global_rank: 5 });
    expect(await readSimilarwebStatus("b")).toMatchObject({ site: "b", global_rank: 5 });
  });

  it("a hand-broken file reads as empty instead of crashing the pages", async () => {
    files.set(SIMILARWEB_FILE, "sites: [oops");
    expect(await readSimilarwebStatuses()).toEqual({});
  });

  it("nothing to write → no commit", async () => {
    await upsertSimilarwebStatuses([]);
    expect(commits).toHaveLength(0);
  });
});
