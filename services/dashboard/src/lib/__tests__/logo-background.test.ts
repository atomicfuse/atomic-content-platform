import { describe, expect, it } from "vitest";
import { logoBackgroundFor } from "../logo-background";

describe("logoBackgroundFor", () => {
  it("Grid: uses colors.surface for the header", () => {
    const result = logoBackgroundFor("grid", { surface: "#f5f5f5", primary: "#111111" });
    expect(result.header).toBe("#f5f5f5");
  });

  it("Grid: defaults header to white when surface is missing", () => {
    const result = logoBackgroundFor("grid", { primary: "#111111" });
    expect(result.header).toBe("#ffffff");
  });

  it("Grid: defaults header to white when colors is undefined", () => {
    const result = logoBackgroundFor("grid", undefined);
    expect(result.header).toBe("#ffffff");
  });

  it("Modern: uses colors.primary for the header (unchanged from today's behaviour)", () => {
    const result = logoBackgroundFor("modern", { surface: "#f5f5f5", primary: "#111111" });
    expect(result.header).toBe("#111111");
  });

  it("Modern: defaults header to #1a1a2e when primary is missing", () => {
    const result = logoBackgroundFor("modern", { surface: "#f5f5f5" });
    expect(result.header).toBe("#1a1a2e");
  });

  it("Modern: defaults header to #1a1a2e when colors is undefined", () => {
    const result = logoBackgroundFor("modern", undefined);
    expect(result.header).toBe("#1a1a2e");
  });

  it("undefined template behaves like Modern (defaults preserved)", () => {
    const result = logoBackgroundFor(undefined, { primary: "#222222" });
    expect(result.header).toBe("#222222");
  });

  it("returns colors.footer_bg as footer for both templates", () => {
    expect(logoBackgroundFor("grid", { footer_bg: "#000000" }).footer).toBe("#000000");
    expect(logoBackgroundFor("modern", { footer_bg: "#000000" }).footer).toBe("#000000");
  });

  it("footer is undefined when footer_bg is missing", () => {
    expect(logoBackgroundFor("grid", {}).footer).toBeUndefined();
    expect(logoBackgroundFor("modern", undefined).footer).toBeUndefined();
  });
});
