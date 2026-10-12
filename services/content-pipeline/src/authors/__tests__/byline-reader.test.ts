import { describe, expect, it, vi } from "vitest";

const calls: Array<{ path: string; ref?: string }> = [];
const files: Record<string, string | number> = {};
vi.mock("../../lib/github.js", () => ({
  parseRepo: () => ({ owner: "atomicfuse", repo: "atomic-labs-network" }),
  createOctokit: () => ({
    repos: {
      getContent: async ({ path, ref }: { path: string; ref?: string }) => {
        calls.push({ path, ref });
        const v = files[`${ref}:${path}`];
        if (v === undefined) throw Object.assign(new Error("Not Found"), { status: 404 });
        if (typeof v === "number") throw Object.assign(new Error("Server Error"), { status: v });
        return { data: { content: Buffer.from(v).toString("base64") } };
      },
    },
  }),
}));

import { authorFileReader, siteAuthorsReader } from "../byline-reader.js";
import type { AgentConfig } from "../../lib/config.js";

const config = { github: { token: "t", repo: "atomicfuse/atomic-labs-network" }, networkRepo: "atomicfuse/atomic-labs-network", localNetworkPath: undefined } as unknown as AgentConfig;

describe("byline readers read GitHub fresh (never the long-lived tree cache)", () => {
  it("author profile from main: found, missing → null, server error → thrown (retried later)", async () => {
    files["main:authors/fiona-galbraith.yaml"] = "id: fiona-galbraith\nname: Fiona Galbraith\n";
    files["main:authors/flaky.yaml"] = 502;
    const read = authorFileReader(config);
    expect(await read("fiona-galbraith")).toContain("Fiona Galbraith");
    expect(await read("nobody")).toBeNull();
    await expect(read("flaky")).rejects.toThrow();
    expect(calls[0]).toEqual({ path: "authors/fiona-galbraith.yaml", ref: "main" });
  });

  it("a site's authors from its branch's site.yaml; unreadable → null (use the brief's)", async () => {
    files["staging/dailybuzzalley:sites/dailybuzzalley/site.yaml"] = "domain: dailybuzzalley\nauthors:\n  - id: fiona-galbraith\n    topics: [Pop Culture Pulse]\n";
    const read = siteAuthorsReader(config);
    expect(await read("dailybuzzalley", "staging/dailybuzzalley")).toEqual([{ id: "fiona-galbraith", topics: ["Pop Culture Pulse"] }]);
    expect(await read("nosite", "staging/nosite")).toBeNull();
  });

  it("a run that writes to a branch reads profiles from GitHub even when LOCAL_NETWORK_PATH is set (it may point at a missing or stale checkout)", async () => {
    files["main:authors/fiona-galbraith.yaml"] = "id: fiona-galbraith\nname: Fiona Galbraith\n";
    const local = { ...config, localNetworkPath: "/no/such/checkout" } as AgentConfig;
    expect(await authorFileReader(local, "staging/dailybuzzalley")("fiona-galbraith")).toContain("Fiona Galbraith");
  });
});

