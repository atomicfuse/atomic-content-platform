import { describe, expect, it } from "vitest";
import { planSiteAuthors } from "../pairing";

const V: Record<string, string> = {
  journeypeaks: "Travel", roadsandviews: "Travel", travelclearly: "Travel", geekytraveler: "Travel", milesandwords: "Travel",
  decotricksworld: "Home & Garden", decoratingmom: "Home & Garden", diydecorschool: "Home & Garden",
  tastereporter: "Food & Drink",
};
const site = (domain: string): { domain: string; vertical?: string } => ({ domain, vertical: V[domain] });

describe("planSiteAuthors (two sites per author)", () => {
  it("pairs sites within a category; an odd one out gets its own author", () => {
    const steps = planSiteAuthors(["journeypeaks", "roadsandviews", "travelclearly", "tastereporter"].map(site), [], V);
    expect(steps).toEqual([
      { kind: "new", sites: ["journeypeaks", "roadsandviews"] },
      { kind: "new", sites: ["travelclearly"] },
      { kind: "new", sites: ["tastereporter"] },
    ]);
  });

  it("an existing one-site author takes a second site from their category first", () => {
    const steps = planSiteAuthors(["journeypeaks", "roadsandviews", "travelclearly"].map(site), [{ id: "selin-aksoy", name: "Selin Aksoy", sites: ["geekytraveler"], exclusive_sites: ["geekytraveler"] }], V);
    expect(steps).toEqual([
      { kind: "join", site: "journeypeaks", authorId: "selin-aksoy", authorName: "Selin Aksoy" },
      { kind: "new", sites: ["roadsandviews", "travelclearly"] },
    ]);
  });

  it("an author created but never assigned gets the site they were made for, plus one more from its category", () => {
    const steps = planSiteAuthors(["decoratingmom", "decotricksworld", "diydecorschool"].map(site), [{ id: "elif-demirci", name: "Elif Demirci", sites: [], exclusive_sites: ["decotricksworld"] }], V);
    expect(steps).toEqual([
      { kind: "join", site: "decotricksworld", authorId: "elif-demirci", authorName: "Elif Demirci" },
      { kind: "join", site: "decoratingmom", authorId: "elif-demirci", authorName: "Elif Demirci" },
      { kind: "new", sites: ["diydecorschool"] },
    ]);
  });

  it("authors who already have two sites are left alone; sites with no category pair among themselves", () => {
    const steps = planSiteAuthors([{ domain: "a" }, { domain: "b" }, site("milesandwords")], [{ id: "x", name: "X", sites: ["geekytraveler", "journeypeaks"], exclusive_sites: [] }], V);
    expect(steps).toEqual([
      { kind: "new", sites: ["a", "b"] },
      { kind: "new", sites: ["milesandwords"] },
    ]);
  });
});
