import { describe, expect, it, vi } from "vitest";
import { ALL_PARTS, missingParts, runParts } from "../generate-flow";
import type { AuthorRecord } from "../types";

const ok = (value: unknown): Response => new Response(JSON.stringify({ status: "ok", value }), { status: 200 });

describe("runParts", () => {
  it("runs parts in order, feeding each result into the next request", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetchFn = vi.fn(async (_u: string, init?: RequestInit) => {
      const b = JSON.parse(String(init!.body)) as Record<string, unknown>;
      bodies.push(b);
      return ok({ name: "Maya Ortiz", tagline: "Coffee writer", bio: "Bio.", beats: ["Coffee", "Brewing"], portrait: { kind: "generated", path: "/authors/assets/maya-ortiz-a.webp" } }[b.part as string]);
    });
    const statuses: string[] = [];
    const out = await runParts(ALL_PARTS, {}, { authorIdFor: () => "maya-ortiz", takenNames: ["Ella Hughes"] }, (p, s) => statuses.push(`${p}:${s}`), fetchFn as unknown as typeof fetch);
    expect(out).toMatchObject({ name: "Maya Ortiz", tagline: "Coffee writer", beats: ["Coffee", "Brewing"], portrait: { kind: "generated" } });
    expect((bodies[1]!.draft as { name?: string }).name).toBe("Maya Ortiz");
    expect(bodies[4]).toMatchObject({ part: "portrait", authorId: "maya-ortiz" });
    expect(bodies[0]!.takenNames).toEqual(["Ella Hughes"]);
    expect(statuses.filter((s) => s.endsWith(":done"))).toHaveLength(5);
  });

  it("a failed part reports its error and the rest still run", async () => {
    const fetchFn = vi.fn(async (_u: string, init?: RequestInit) => {
      const part = (JSON.parse(String(init!.body)) as { part: string }).part;
      return part === "portrait"
        ? new Response(JSON.stringify({ status: "error", message: "Portrait failed: OpenAI 500" }), { status: 502 })
        : ok(part === "beats" ? ["A", "B"] : "x");
    });
    const errors: string[] = [];
    await runParts(["tagline", "portrait", "beats"], { name: "Maya Ortiz" }, { authorIdFor: () => "maya-ortiz", takenNames: [] }, (p, s, e) => { if (s === "error") errors.push(`${p}: ${e}`); }, fetchFn as unknown as typeof fetch);
    expect(errors).toEqual(["portrait: Portrait failed: OpenAI 500"]);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });
});

describe("missingParts", () => {
  it("bio-less authors get tagline/bio/beats as needed; portrait-less get a portrait", () => {
    const a = { name: "A B", tagline: "", bio: "", beats: ["X", "Y"], portrait: null } as unknown as AuthorRecord;
    expect(missingParts(a)).toEqual(["tagline", "bio", "portrait"]);
  });
});
