import { describe, expect, it } from "vitest";
import { applyGridConfigUpdates } from "../grid-config";

describe("applyGridConfigUpdates", () => {
  it("sets theme.template grid and keeps other theme keys (incl. base preset id)", () => {
    const existing: Record<string, unknown> = { theme: { base: "classic", colors: { accent: "#f00" } } };
    applyGridConfigUpdates(existing, { theme_template: "grid" });
    expect(existing.theme).toEqual({ base: "classic", colors: { accent: "#f00" }, template: "grid" });
  });
  it("switching back to modern removes the key (absent = modern)", () => {
    const existing: Record<string, unknown> = { theme: { template: "grid", base: "classic" } };
    applyGridConfigUpdates(existing, { theme_template: "modern" });
    expect(existing.theme).toEqual({ base: "classic" });
  });
  it("replaces theme.card and grid wholesale; untouched when absent", () => {
    const existing: Record<string, unknown> = { theme: {}, grid: { per_site_limit: 5 } };
    applyGridConfigUpdates(existing, { theme_card: { style: "shadow" } });
    expect(existing).toEqual({ theme: { card: { style: "shadow" } }, grid: { per_site_limit: 5 } });
    applyGridConfigUpdates(existing, { grid: { topics: [{ label: "T", verticals: ["Travel"] }] } });
    expect(existing.grid).toEqual({ topics: [{ label: "T", verticals: ["Travel"] }] });
  });
  it("no-op for an update with no Grid fields", () => {
    const existing: Record<string, unknown> = { theme: { base: "x" } };
    applyGridConfigUpdates(existing, {});
    expect(existing).toEqual({ theme: { base: "x" } });
  });
});
