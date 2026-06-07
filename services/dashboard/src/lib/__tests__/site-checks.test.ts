import { describe, expect, it } from "vitest";

import type { ExternalChecks } from "@/lib/domains-dashboard";
import {
  mergeChecks,
  type AtlChecks,
} from "@/lib/site-checks";

function okExternal(): ExternalChecks {
  return {
    uptime: {
      state: "ok",
      ok: true,
      statusCode: 200,
      responseTimeMs: 120,
      overallStatus: "up",
      checkedAt: "2026-06-07T00:00:00Z",
    },
    ssl: { state: "ok", status: "valid", daysLeft: 80, expiresAt: "2026-09-01" },
    domain: { state: "ok", daysLeft: 300, expiresAt: "2027-04-01", autoRenew: true },
  };
}

function okAtl(siteDomain: string): AtlChecks {
  return {
    siteDomain,
    sync: {
      state: "ok",
      ok: true,
      syncedAt: "2026-06-07T00:00:00Z",
      gitSha: "abc123",
      error: null,
    },
    tracking: { state: "ok", ga4: true, gtm: true, pixel: false },
  };
}

describe("mergeChecks", () => {
  it("looks up sync/tracking by folder name and external by custom domain", () => {
    const index = [{ domain: "travelswire", custom_domain: "travelswire.com" }];
    const atlByFolder = new Map<string, AtlChecks>([
      ["travelswire", okAtl("travelswire")],
    ]);
    const externalByDomain = new Map<string, ExternalChecks>([
      ["travelswire.com", okExternal()],
    ]);

    const [site] = mergeChecks(index, atlByFolder, externalByDomain);

    expect(site.siteDomain).toBe("travelswire");
    // External resolved via custom domain.
    expect(site.checks.uptime.state).toBe("ok");
    expect(site.checks.ssl.daysLeft).toBe(80);
    expect(site.checks.domain.autoRenew).toBe(true);
    // ATL resolved via folder name.
    expect(site.checks.sync.gitSha).toBe("abc123");
    expect(site.checks.tracking.ga4).toBe(true);
  });

  it("does NOT match external by folder name (only custom domain)", () => {
    const index = [{ domain: "travelswire", custom_domain: "travelswire.com" }];
    const atlByFolder = new Map<string, AtlChecks>();
    // Map mistakenly keyed by folder name — must NOT be picked up.
    const externalByDomain = new Map<string, ExternalChecks>([
      ["travelswire", okExternal()],
    ]);

    const [site] = mergeChecks(index, atlByFolder, externalByDomain);

    expect(site.checks.uptime.state).toBe("unknown");
    expect(site.checks.ssl.state).toBe("unknown");
    expect(site.checks.domain.state).toBe("unknown");
  });

  it("returns n/a external blocks for staging-only sites (no custom_domain)", () => {
    const index = [{ domain: "chaibeseret", custom_domain: null }];
    const atlByFolder = new Map<string, AtlChecks>([
      ["chaibeseret", okAtl("chaibeseret")],
    ]);
    const externalByDomain = new Map<string, ExternalChecks>();

    const [site] = mergeChecks(index, atlByFolder, externalByDomain);

    expect(site.checks.uptime.state).toBe("n/a");
    expect(site.checks.ssl.state).toBe("n/a");
    expect(site.checks.domain.state).toBe("n/a");
    // Sync/tracking still resolved.
    expect(site.checks.sync.state).toBe("ok");
    expect(site.checks.tracking.state).toBe("ok");
  });

  it("falls back to unknown sync/tracking when the site was never checked", () => {
    const index = [{ domain: "wtpop", custom_domain: null }];
    const atlByFolder = new Map<string, AtlChecks>();
    const externalByDomain = new Map<string, ExternalChecks>();

    const [site] = mergeChecks(index, atlByFolder, externalByDomain);

    expect(site.checks.sync.state).toBe("unknown");
    expect(site.checks.sync.ok).toBeNull();
    expect(site.checks.tracking.state).toBe("unknown");
    expect(site.checks.tracking.ga4).toBe(false);
  });

  it("uses unknown external when custom_domain is set but absent from the map", () => {
    const index = [{ domain: "wineoceans", custom_domain: "wineoceans.com" }];
    const atlByFolder = new Map<string, AtlChecks>();
    const externalByDomain = new Map<string, ExternalChecks>(); // Domains Dashboard down

    const [site] = mergeChecks(index, atlByFolder, externalByDomain);

    expect(site.checks.uptime.state).toBe("unknown");
    expect(site.checks.ssl.state).toBe("unknown");
    expect(site.checks.domain.state).toBe("unknown");
  });

  it("preserves index order and maps every site", () => {
    const index = [
      { domain: "a", custom_domain: "a.com" },
      { domain: "b", custom_domain: null },
      { domain: "c", custom_domain: "c.com" },
    ];
    const result = mergeChecks(index, new Map(), new Map());
    expect(result.map((s) => s.siteDomain)).toEqual(["a", "b", "c"]);
  });
});
