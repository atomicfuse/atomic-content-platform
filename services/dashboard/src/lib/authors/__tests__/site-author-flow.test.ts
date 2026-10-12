import { describe, expect, it, vi } from "vitest";
import { generateSiteAuthor } from "../site-author-flow";

const VALUES: Record<string, unknown> = {
  name: "Nia Okafor", tagline: "Travel writer", bio: "Bio.", beats: ["Hiking", "Trails"], verticals: ["Travel"],
  portrait: { kind: "generated", path: "/authors/assets/nia-okafor-0123456789.webp" },
};

describe("generateSiteAuthor", () => {
  it("builds a complete author (not exclusive) using the site as context and avoiding taken names", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetchFn = vi.fn(async (_u: string, init?: RequestInit) => {
      const b = JSON.parse(String(init!.body)) as Record<string, unknown>;
      bodies.push(b);
      return new Response(JSON.stringify({ status: "ok", value: VALUES[b.part as string] }), { status: 200 });
    });
    const out = await generateSiteAuthor({ domain: "journeypeaks", siteName: "Journey Peaks", vertical: "Travel", topics: ["Hiking"], audience: "Weekend hikers" }, { names: ["Ella Hughes"], ids: ["ella-hughes"] }, ["Travel"], undefined, fetchFn as unknown as typeof fetch);
    expect(out).toMatchObject({ name: "Nia Okafor", verticals: ["Travel"], exclusive_sites: [], portrait: { kind: "generated" } });
    expect(bodies.map((b) => b.part)).toEqual(["name", "tagline", "bio", "beats", "verticals", "portrait"]);
    expect(bodies[0]).toMatchObject({ siteContext: { site: "journeypeaks", siteName: "Journey Peaks", category: "Travel", topics: ["Hiking"], audience: "Weekend hikers" }, takenNames: ["Ella Hughes"] });
    expect(bodies[5]).toMatchObject({ portraitStyle: "realistic", authorId: "nia-okafor" });
  });

  it("no name generated → null (nothing to save); no category list → the verticals part is skipped", async () => {
    const fetchFn = vi.fn(async (_u: string, init?: RequestInit) => {
      const part = (JSON.parse(String(init!.body)) as { part: string }).part;
      return part === "name"
        ? new Response(JSON.stringify({ status: "error", message: "nope" }), { status: 422 })
        : new Response(JSON.stringify({ status: "ok", value: VALUES[part] }), { status: 200 });
    });
    expect(await generateSiteAuthor({ domain: "x", siteName: "X", topics: [] }, { names: [], ids: [] }, [], undefined, fetchFn as unknown as typeof fetch)).toBeNull();
    expect(fetchFn.mock.calls.map(([, i]) => (JSON.parse(String(i!.body)) as { part: string }).part)).not.toContain("verticals");
  });
});
