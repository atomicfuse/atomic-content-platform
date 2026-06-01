import { describe, it, expect } from "vitest";
import { validateBatch } from "../../agents/migration/batch-import.js";

describe("validateBatch", () => {
  it("rejects empty rows", () => {
    const result = validateBatch([]);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/empty/i);
  });

  it("rejects batch exceeding max size", () => {
    const rows = Array.from({ length: 201 }, (_, i) => ({
      "Site Name": `Site ${i}`,
      domain: `site${i}.com`,
    }));
    const result = validateBatch(rows);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/200/);
  });

  it("detects duplicate domains within CSV", () => {
    const rows = [
      { "Site Name": "Site A", domain: "example.com" },
      { "Site Name": "Site B", domain: "example.com" },
    ];
    const result = validateBatch(rows);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/duplicate/i);
  });

  it("rejects rows missing both name and domain", () => {
    const rows = [{ "Site Name": "", domain: "" }];
    const result = validateBatch(rows);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/missing/i);
  });

  it("passes valid batch", () => {
    const rows = [
      { "Site Name": "Site A", domain: "site-a.com" },
      { "Site Name": "Site B", domain: "site-b.com" },
    ];
    const result = validateBatch(rows);
    expect(result.ok).toBe(true);
  });
});
