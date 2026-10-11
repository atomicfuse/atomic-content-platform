import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("../RefreshCacheButton", () => ({ RefreshCacheButton: () => null }));
import { SiteDetailHeader } from "../SiteDetailHeader";

afterEach(cleanup);
const site = { domain: "journeypeaks", custom_domain: "journeypeaks.com", status: "Live", company: "ATL", vertical: "Travel" } as never;
const status = { site: "journeypeaks", domain: "journeypeaks.com", has_rank: true, global_rank: 79692, monthly_visits: 1340000, checked_at: "2026-10-11T08:00:00.000Z", source: "manual" as const };

describe("SiteDetailHeader Similarweb badge", () => {
  it("shows rank and visits with the check date in the tooltip", () => {
    render(<SiteDetailHeader site={site} similarweb={status} />);
    const badge = screen.getByText("Similarweb #79,692 · 1.34M/mo");
    expect(badge.getAttribute("title")).toBe("Checked Oct 11, 2026 (manual)");
  });
  it("no badge when never checked", () => {
    render(<SiteDetailHeader site={site} similarweb={null} />);
    expect(screen.queryByText(/Similarweb/)).toBeNull();
  });
  it("no badge for a site without a domain, even with an old result", () => {
    render(<SiteDetailHeader site={{ ...(site as object), custom_domain: null } as never} similarweb={status} />);
    expect(screen.queryByText(/Similarweb/)).toBeNull();
  });
});

