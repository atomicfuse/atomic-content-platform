import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  generateMonetizationJson,
  generateAllMonetizationJson,
} from "../generate-monetization-json.js";
import { resolveConfig } from "../resolve-config.js";
import {
  generateAdsTxt,
  buildAdsTxtForSite,
} from "../generate-ads-txt.js";

const FIXTURES_MON = join(import.meta.dirname, "fixtures-mon");
const FIXTURES = join(import.meta.dirname, "fixtures");

describe("generateMonetizationJson", () => {
  let outDir: string;

  beforeEach(async () => {
    outDir = await mkdtemp(join(tmpdir(), "mon-json-"));
  });

  afterEach(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  it("writes <domain>.json to outputDir", async () => {
    const result = await generateMonetizationJson({
      networkRepoPath: FIXTURES_MON,
      siteDomain: "default-site.example.com",
      outputDir: outDir,
    });

    expect(result.outputPath).toBe(
      join(outDir, "default-site.example.com.json"),
    );

    const written = JSON.parse(await readFile(result.outputPath, "utf-8"));
    expect(written.domain).toBe("default-site.example.com");
    expect(written.monetization_id).toBe("standard-ads");
    expect(written.tracking).toBeDefined();
    expect(written.scripts).toBeDefined();
    expect(written.ads_config).toBeDefined();
    expect(typeof written.generated_at).toBe("string");
  });

  it("uses the site-specified profile when provided", async () => {
    const result = await generateMonetizationJson({
      networkRepoPath: FIXTURES_MON,
      siteDomain: "override-site.example.com",
      outputDir: outDir,
    });

    expect(result.json.monetization_id).toBe("premium-ads");
  });

  it("propagates errors when profile is missing", async () => {
    await expect(
      generateMonetizationJson({
        networkRepoPath: FIXTURES_MON,
        siteDomain: "bad-profile.example.com",
        outputDir: outDir,
      }),
    ).rejects.toThrow(/nonexistent-profile/);
  });
});

describe("generateAllMonetizationJson", () => {
  let outDir: string;

  beforeEach(async () => {
    outDir = await mkdtemp(join(tmpdir(), "mon-json-all-"));
  });

  afterEach(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  it("writes JSON for valid sites and reports errors for the rest", async () => {
    const { succeeded, errors } = await generateAllMonetizationJson(
      FIXTURES_MON,
      outDir,
    );

    const succeededDomains = succeeded.map((r) => r.json.domain).sort();
    expect(succeededDomains).toEqual([
      "default-site.example.com",
      "null-clear.example.com",
      "override-site.example.com",
    ]);

    expect(errors).toEqual([
      expect.objectContaining({
        siteDomain: "bad-profile.example.com",
        error: expect.stringMatching(/nonexistent-profile/),
      }),
    ]);
  });
});

describe("generateAdsTxt", () => {
  it("emits a deterministic ads.txt with header and dedup", async () => {
    const config = await resolveConfig(FIXTURES_MON, "override-site.example.com");
    const txt = generateAdsTxt(config, { generatedAt: "2026-04-15" });
    const lines = txt.trim().split("\n");

    // First line is the header
    expect(lines[0]).toBe(
      "# ads.txt for override-site.example.com — auto-generated 2026-04-15",
    );

    // Body lines are sorted and unique
    const bodyLines = lines.slice(1);
    const sortedCopy = [...bodyLines].sort();
    expect(bodyLines).toEqual(sortedCopy);
    expect(new Set(bodyLines).size).toBe(bodyLines.length);
  });

  it("renders per-source comment lines when sources provided", async () => {
    const config = await resolveConfig(FIXTURES_MON, "override-site.example.com");
    const txt = generateAdsTxt(config, {
      generatedAt: "2026-04-15",
      sources: {
        org: ["org-entry.com, 1, DIRECT"],
        monetization: ["mon-entry.com, 2, DIRECT"],
        site: ["site-entry.com, 3, DIRECT"],
      },
      monetizationLabel: "premium-ads",
    });

    expect(txt).toContain("# Source: org");
    expect(txt).toContain("# Source: monetization (premium-ads)");
    expect(txt).toContain("# Source: site");
  });
});

describe("buildAdsTxtForSite", () => {
  it("re-reads layer YAMLs to attribute sources", async () => {
    const config = await resolveConfig(FIXTURES_MON, "override-site.example.com");
    const txt = await buildAdsTxtForSite({
      networkRepoPath: FIXTURES_MON,
      siteDomain: "override-site.example.com",
      resolvedConfig: config,
    });

    expect(txt).toContain("# ads.txt for override-site.example.com");
    expect(txt).toContain("site-specific.com, 42, DIRECT");
  });

  it("works on networks without a monetization layer", async () => {
    const config = await resolveConfig(FIXTURES, "test-site.example.com");
    const txt = await buildAdsTxtForSite({
      networkRepoPath: FIXTURES,
      siteDomain: "test-site.example.com",
      resolvedConfig: config,
    });

    expect(txt.startsWith("# ads.txt for test-site.example.com")).toBe(true);
    expect(txt.trim().split("\n").length).toBeGreaterThan(1);
  });
});
