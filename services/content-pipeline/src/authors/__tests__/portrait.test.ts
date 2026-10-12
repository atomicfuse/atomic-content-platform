import { describe, expect, it } from "vitest";
import { generatePortraitImage, pickLooks, portraitPrompt } from "../portrait.js";

/** Deterministic rng from a list of values in [0, 1). */
const seq = (...v: number[]): (() => number) => { let i = 0; return () => v[i++ % v.length]!; };

describe("portrait looks", () => {
  it("two portraits get different concrete looks (no single default face)", () => {
    const a = portraitPrompt({ name: "Maya Ortiz", beats: ["Coffee"] }, seq(0.05));
    const b = portraitPrompt({ name: "Maya Ortiz", beats: ["Coffee"] }, seq(0.95));
    expect(a).not.toBe(b);
    for (const p of [a, b]) {
      expect(p).toMatch(/Age:/);
      expect(p).toMatch(/Hair style:/);
      expect(p).toMatch(/Wearing:/);
      expect(p).toMatch(/Background:/);
    }
  });

  it("spreads across many draws (each trait takes several values)", () => {
    let x = 0;
    const rng = (): number => { x = (x * 9301 + 49297) % 233280; return x / 233280; };
    const looks = Array.from({ length: 40 }, () => pickLooks(rng));
    for (const key of ["age", "hair", "clothing", "background", "angle", "expression"] as const) {
      expect(new Set(looks.map((l) => l[key])).size).toBeGreaterThanOrEqual(4);
    }
  });

  it("illustrated style keeps the house style: never a photo, no text", () => {
    const p = portraitPrompt({ name: "Ben Foster" }, seq(0.5), "illustrated");
    expect(p).toMatch(/NOT a photograph/);
    expect(p).toMatch(/No text/);
    expect(p).toContain("Ben Foster");
  });
  it("realistic style asks for a natural photograph with the same varied looks", () => {
    const p = portraitPrompt({ name: "Maya Ortiz" }, seq(0.3), "realistic");
    expect(p).toMatch(/photograph/i);
    expect(p).not.toMatch(/NOT a photograph/);
    expect(p).toMatch(/Age:/);
  });

  it("the image request uses medium quality (fast enough to finish well inside the request limit)", async () => {
    process.env.OPENAI_API_KEY = "test";
    let sent: Record<string, unknown> = {};
    const fetchFn = (async (_u: string, init?: RequestInit) => {
      sent = JSON.parse(String(init!.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }) as unknown as typeof fetch;
    await expect(generatePortraitImage("maya-ortiz", { name: "Maya Ortiz" }, "realistic", fetchFn)).rejects.toThrow(/no image/);
    expect(sent.quality).toBe("medium");
    expect(String(sent.prompt)).toMatch(/photograph/i);
  });
  it("skin tone and hair colour follow the name, not a random draw", () => {
    const p = portraitPrompt({ name: "Maren Kowalczyk" }, seq(0.9), "realistic");
    expect(p).not.toMatch(/Skin:/);
    expect(p).toMatch(/plausible for someone named Maren Kowalczyk/);
    expect(p).not.toMatch(/auburn|copper|sandy-blond|chestnut|black hair/i);
  });
});
