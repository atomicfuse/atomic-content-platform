import { describe, it, expect } from "vitest";
import {
  parseColorPalette,
  parseGaInfo,
  parseCsvRow,
} from "../../agents/migration/csv-parser.js";

describe("parseColorPalette", () => {
  it("parses a standard color palette string", () => {
    const input =
      "primary: #F43656, secondary: #C87137, accent: #B80000, text: #000000, background: #FFFFFF";
    const result = parseColorPalette(input);
    expect(result).toEqual({
      primary: "#F43656",
      secondary: "#C87137",
      accent: "#B80000",
      text: "#000000",
      background: "#FFFFFF",
    });
  });

  it("handles extra whitespace around keys and values", () => {
    const input = "  primary :  #FF0000 ,  secondary :  #00FF00  ";
    const result = parseColorPalette(input);
    expect(result).toEqual({
      primary: "#FF0000",
      secondary: "#00FF00",
    });
  });

  it("returns empty object for empty string", () => {
    expect(parseColorPalette("")).toEqual({});
  });

  it("returns empty object for whitespace-only string", () => {
    expect(parseColorPalette("   ")).toEqual({});
  });
});

describe("parseGaInfo", () => {
  it("parses full GA info with property, measurement, and GTM", () => {
    const input = "328395426, G-HL2D8CQ0Z9, GT-5R65N74B";
    const result = parseGaInfo(input);
    expect(result).toEqual({
      gaPropertyId: "328395426",
      gaMeasurementId: "G-HL2D8CQ0Z9",
      gtmId: "GT-5R65N74B",
    });
  });

  it("handles missing GTM", () => {
    const input = "328395426, G-HL2D8CQ0Z9";
    const result = parseGaInfo(input);
    expect(result).toEqual({
      gaPropertyId: "328395426",
      gaMeasurementId: "G-HL2D8CQ0Z9",
    });
  });

  it("handles empty string", () => {
    const result = parseGaInfo("");
    expect(result).toEqual({});
  });

  it("handles whitespace-only string", () => {
    const result = parseGaInfo("   ");
    expect(result).toEqual({});
  });

  it("identifies tokens by prefix regardless of order", () => {
    const input = "G-ABC123, GT-XYZ789, 999111";
    const result = parseGaInfo(input);
    expect(result).toEqual({
      gaPropertyId: "999111",
      gaMeasurementId: "G-ABC123",
      gtmId: "GT-XYZ789",
    });
  });
});

describe("parseCsvRow", () => {
  const fullRow: Record<string, string> = {
    Name: "travelbeautytips.com",
    Company: "ATL",
    "Website Category": "Style & Fashion",
    "Menu Items": "Beauty, Fashion, Hair, Makeup Hacks, Makeup Tutorial, Nails, Weight Loss",
    "IAB Top Categories (Vertical)": "Style & Fashion, Health & Fitness",
    "Sub Categories": "Beauty, Skincare, Hair Care",
    "Color Palette":
      "primary: #F43656, secondary: #C87137, accent: #B80000, text: #000000, background: #FFFFFF",
    Logo: "https://travelbeautytips.com/wp-content/uploads/logo.png",
    Favicon: "https://travelbeautytips.com/wp-content/uploads/favicon.png",
    "Posts REST API (articles)":
      "https://travelbeautytips.com/wp-json/wp/v2/posts?per_page=75",
    "GA Info": "328395426, G-HL2D8CQ0Z9, GT-5R65N74B",
  };

  it("parses a full row into CsvSiteRow", () => {
    const result = parseCsvRow(fullRow);
    expect(result.name).toBe("travelbeautytips.com");
    expect(result.websiteCategory).toBe("Style & Fashion");
    expect(result.menuItems).toEqual([
      "Beauty",
      "Fashion",
      "Hair",
      "Makeup Hacks",
      "Makeup Tutorial",
      "Nails",
      "Weight Loss",
    ]);
    expect(result.iabCategories).toEqual(["Style & Fashion", "Health & Fitness"]);
    expect(result.subCategories).toEqual(["Beauty", "Skincare", "Hair Care"]);
    expect(result.colorPalette).toEqual({
      primary: "#F43656",
      secondary: "#C87137",
      accent: "#B80000",
      text: "#000000",
      background: "#FFFFFF",
    });
    expect(result.logoUrl).toBe(
      "https://travelbeautytips.com/wp-content/uploads/logo.png",
    );
    expect(result.faviconUrl).toBe(
      "https://travelbeautytips.com/wp-content/uploads/favicon.png",
    );
    expect(result.postsApiUrl).toBe(
      "https://travelbeautytips.com/wp-json/wp/v2/posts?per_page=75",
    );
    expect(result.gaInfo).toEqual({
      gaPropertyId: "328395426",
      gaMeasurementId: "G-HL2D8CQ0Z9",
      gtmId: "GT-5R65N74B",
    });
  });

  it("handles empty comma-separated fields as empty arrays", () => {
    const row: Record<string, string> = {
      ...fullRow,
      "Menu Items": "",
      "IAB Top Categories (Vertical)": "",
      "Sub Categories": "",
    };
    const result = parseCsvRow(row);
    expect(result.menuItems).toEqual([]);
    expect(result.iabCategories).toEqual([]);
    expect(result.subCategories).toEqual([]);
  });

  it("trims whitespace from all parsed values", () => {
    const row: Record<string, string> = {
      ...fullRow,
      Name: "  example.com  ",
      "Menu Items": "  Beauty ,  Fashion  ",
    };
    const result = parseCsvRow(row);
    expect(result.name).toBe("example.com");
    expect(result.menuItems).toEqual(["Beauty", "Fashion"]);
  });
});
