import { describe, expect, it } from "vitest";
import { bioProblem, buildTextPrompt, parseTextPart } from "../text.js";

const BIO_OK = Array.from({ length: 80 }, (_, i) => (i === 0 ? "Maya" : "word")).join(" ") + ".";

describe("bioProblem", () => {
  it("accepts a plain 60–120 word bio", () => {
    expect(bioProblem(BIO_OK)).toBeNull();
  });
  it("rejects length outside 60–120 words", () => {
    expect(bioProblem("Too short.")).toMatch(/60–120 words/);
    expect(bioProblem(Array(130).fill("word").join(" "))).toMatch(/60–120 words/);
  });
  it.each([
    "She is an award-winning writer",
    "He holds a degree in film studies",
    "A former editor at a national magazine",
    "She worked at The Times for years",
    "Graduated from Columbia University",
    "Her work has been featured in Vogue",
  ])("rejects invented credentials: %s", (claim) => {
    expect(bioProblem(`${claim}. ${BIO_OK}`)).toMatch(/credential/i);
  });
  it.each([
    "Her work has appeared in Vogue",
    "A Pulitzer-nominated reporter",
    "She studied journalism at NYU",
    "He spent a decade at The Guardian",
    "Trained at Le Cordon Bleu",
    "A veteran reporter",
    "A proud Yale alum",
    "She is a certified sommelier",
  ])("rejects other credential phrasing: %s", (claim) => {
    expect(bioProblem(`${claim}. ${BIO_OK}`)).toMatch(/credential/i);
  });
  it.each([
    "She covers red carpets and awards season",
    "He lives for college football",
    "Our royals correspondent at heart",
    "Never misses the Masters",
    "Collects licensed merch",
    "Bakes at 350 degrees",
    "Tours the former royal residence",
  ])("accepts ordinary beat language: %s", (line) => {
    expect(bioProblem(`${line}. ${BIO_OK}`)).toBeNull();
  });
  it("rejects leaked prompt jargon", () => {
    expect(bioProblem(`${BIO_OK} As the brief says.`)).toMatch(/brief/i);
  });
});

describe("parseTextPart", () => {
  it("name: First Last, not already taken (any case)", () => {
    expect(parseTextPart("name", '{"name":"Maya Ortiz"}', [])).toEqual({ ok: true, value: "Maya Ortiz" });
    expect(parseTextPart("name", '{"name":"maya ortiz"}', ["Maya Ortiz"])).toMatchObject({ ok: false });
    expect(parseTextPart("name", '{"name":"x"}', [])).toMatchObject({ ok: false });
  });
  it("tagline: short, no trailing period", () => {
    expect(parseTextPart("tagline", '{"tagline":"Celebrity & royals writer."}', [])).toEqual({ ok: true, value: "Celebrity & royals writer" });
    expect(parseTextPart("tagline", `{"tagline":"${"x".repeat(80)}"}`, [])).toMatchObject({ ok: false });
  });
  it("beats: 2–5 unique short items", () => {
    expect(parseTextPart("beats", '{"beats":["Royals","Celebrities","royals"]}', [])).toEqual({ ok: true, value: ["Royals", "Celebrities"] });
    expect(parseTextPart("beats", '{"beats":["Only"]}', [])).toMatchObject({ ok: false });
  });
  it("tolerates code fences around the JSON; rejects non-JSON", () => {
    const fence = "`".repeat(3);
    expect(parseTextPart("tagline", `${fence}json\n{"tagline":"Film writer"}\n${fence}`, [])).toEqual({ ok: true, value: "Film writer" });
    expect(parseTextPart("tagline", "Film writer", [])).toMatchObject({ ok: false });
  });
});

describe("buildTextPrompt", () => {
  it("carries the site context, current draft and taken names", () => {
    const p = buildTextPrompt("bio", { name: "Maya Ortiz", beats: ["Coffee"] }, { siteName: "Coffee Actually", topics: ["Brewing"], tone: "friendly" }, ["Ella Hughes"]);
    expect(p.user).toContain("Maya Ortiz");
    expect(p.user).toContain("Coffee Actually");
    expect(p.user).toContain("Brewing");
    expect(p.system).toMatch(/no invented credentials/i);
    const n = buildTextPrompt("name", {}, {}, ["Ella Hughes"]);
    expect(n.user).toContain("Ella Hughes");
  });
});
