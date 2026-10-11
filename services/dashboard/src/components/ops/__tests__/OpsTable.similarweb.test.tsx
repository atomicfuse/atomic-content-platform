import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { OpsRow } from "@/lib/ops-helpers";
import { OpsTable } from "../OpsTable";

afterEach(cleanup);

function row(domain: string, customDomain: string | null): OpsRow {
  return {
    domain, status: "Live", customDomain, vertical: "", failedArticles7d: 0, failedArticles30d: 0,
    imageGenFailed7d: 0, imageGenFailed30d: 0, reviewCount: 0, generalImages: 0, todayCreated: 0,
    todayExpected: 0, thisWeekCreated: 0, schedule: null, recentArticles: [], lastAdded: null, lastFailedAt: null,
    uptime: { state: "n/a", ok: true, statusCode: null, responseTimeMs: null },
    sync: { state: "ok", ok: true, syncedAt: null, error: null },
    ssl: { state: "n/a", status: null, daysLeft: null, expiresAt: null },
    tracking: { state: "n/a", ga4: false, gtm: false, pixel: false },
    domainExpiry: { state: "n/a", daysLeft: null, expiresAt: null, autoRenew: null },
    alerts: [], tier: 4,
  };
}

const ROWS = [row("unranked", "unranked.com"), row("worse", "worse.com"), row("best", "best.com"), row("nodomain", null)];
const at = "2026-10-11T08:00:00.000Z";
const SW = {
  unranked: { site: "unranked", domain: "unranked.com", has_rank: false, global_rank: null, monthly_visits: null, checked_at: at, source: "manual" as const },
  worse: { site: "worse", domain: "worse.com", has_rank: true, global_rank: 900000, monthly_visits: 6008, checked_at: at, source: "manual" as const },
  best: { site: "best", domain: "best.com", has_rank: true, global_rank: 79692, monthly_visits: 1340000, checked_at: at, source: "manual" as const },
};

describe("Dashboard home table — Similarweb column", () => {
  it("shows rank / no rank / no domain per site", () => {
    render(<OpsTable rows={ROWS} similarweb={SW} similarwebLoaded />);
    expect(screen.getByRole("columnheader", { name: /similarweb/i })).toBeTruthy();
    expect(screen.getByText("#79,692 · 1.34M/mo")).toBeTruthy();
    expect(screen.getByText("No rank")).toBeTruthy();
    expect(screen.getByText("No domain")).toBeTruthy();
  });

  it("sorting by Similarweb puts the best rank first and empty states last", () => {
    render(<OpsTable rows={ROWS} similarweb={SW} similarwebLoaded />);
    fireEvent.click(screen.getByRole("columnheader", { name: /similarweb/i }));
    const firstCells = screen.getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell")[0]!.textContent);
    expect(firstCells).toEqual(["best.com", "worse.com", "unranked.com", "nodomain"]);
  });
});
