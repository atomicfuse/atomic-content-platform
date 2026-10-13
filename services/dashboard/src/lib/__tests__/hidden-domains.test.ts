import { beforeEach, describe, expect, it, vi } from "vitest";

const files = new Map<string, string>();
const commits: Array<{ files: Array<{ path: string; content: string | Buffer }>; message: string; branch: string }> = [];
vi.mock("@/lib/github", () => ({
  readFileContent: vi.fn(async (path: string) => files.get(path) ?? null),
  commitNetworkFiles: vi.fn(async (f: Array<{ path: string; content: string | Buffer }>, message: string, branch: string) => {
    commits.push({ files: f, message, branch });
    for (const x of f) files.set(x.path, String(x.content));
  }),
}));

import { HIDDEN_DOMAINS_FILE, readHiddenDomains, setDomainHidden } from "../hidden-domains";

describe("hidden domains (network repo hidden-domains.yaml on main)", () => {
  beforeEach(() => { files.clear(); commits.length = 0; });

  it("no file yet → nothing hidden", async () => {
    expect([...(await readHiddenDomains())]).toEqual([]);
  });

  it("hide then unhide round-trips through one commit each on main", async () => {
    await setDomainHidden("B.com", true);
    await setDomainHidden("a.com", true);
    expect([...(await readHiddenDomains())]).toEqual(["a.com", "b.com"]);
    expect(commits).toHaveLength(2);
    expect(commits[1]).toMatchObject({ branch: "main", message: "dashboard: hide domain a.com" });
    expect(commits[1]!.files[0]!.path).toBe(HIDDEN_DOMAINS_FILE);

    await setDomainHidden("b.com", false);
    expect([...(await readHiddenDomains())]).toEqual(["a.com"]);
  });

  it("does not commit when the domain is already in that state", async () => {
    await setDomainHidden("a.com", true);
    await setDomainHidden("a.com", true);
    await setDomainHidden("x.com", false);
    expect(commits).toHaveLength(1);
  });

  it("a hand-broken file reads as nothing hidden instead of crashing", async () => {
    files.set(HIDDEN_DOMAINS_FILE, "domains: [oops");
    expect([...(await readHiddenDomains())]).toEqual([]);
  });

  it("ignores non-string entries in a hand-edited file", async () => {
    files.set(HIDDEN_DOMAINS_FILE, "domains:\n  - a.com\n  - 42\n  - \" C.com \"\n");
    expect([...(await readHiddenDomains())]).toEqual(["a.com", "c.com"]);
  });
});
