import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DashboardSiteEntry } from "@/types/dashboard";

afterEach(cleanup);

vi.mock("@/hooks/useReferenceData", () => ({
  useVerticals: () => ({ verticals: [], loading: false }),
}));

vi.mock("@/actions/sites", () => ({
  deleteSiteEntry: vi.fn(),
  updateSiteEntry: vi.fn(),
}));

function makeSite(overrides: Partial<DashboardSiteEntry> = {}): DashboardSiteEntry {
  return {
    domain: "coolnews",
    company: "ATL",
    vertical: "News",
    status: "Live",
    site_id: "site_123",
    exclusivity: null,
    ob_epid: null,
    ga_info: null,
    cf_apo: false,
    fixed_ad: false,
    last_updated: "2026-01-01T00:00:00Z",
    created_at: "2025-06-15T00:00:00Z",
    pages_project: null,
    pages_subdomain: null,
    zone_id: null,
    staging_branch: "staging/coolnews",
    preview_url: "https://coolnews.pages.dev",
    saved_previews: null,
    custom_domain: "coolnews.dev",
    ...overrides,
  };
}

const SITES = [
  makeSite({ domain: "ranked", custom_domain: "ranked.com" }),
  makeSite({ domain: "unranked", custom_domain: "unranked.com" }),
  makeSite({ domain: "nodomain", custom_domain: null }),
];

const STATUSES = {
  ranked: { site: "ranked", domain: "ranked.com", has_rank: true, global_rank: 79692, monthly_visits: 1340000, checked_at: "2026-10-11T08:00:00.000Z", source: "manual" },
  unranked: { site: "unranked", domain: "unranked.com", has_rank: false, global_rank: null, monthly_visits: null, checked_at: "2026-10-11T08:00:00.000Z", source: "manual" },
};

/** /api/sites/similarweb stays pending until resolveSimilarweb() is called. */
function mockFetchWithPendingSimilarweb(): { resolveSimilarweb: () => void } {
  let resolveFetch!: () => void;
  const pending = new Promise<Response>((resolve) => {
    resolveFetch = () => resolve({ ok: true, json: async () => ({ statuses: STATUSES }) } as Response);
  });
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/sites/similarweb")) return pending;
    if (url.includes("/api/sites/article-counts") || url.includes("/api/sites/latest-articles") || url.includes("/api/sites/groups")) {
      return { ok: true, json: async () => ({}) } as Response;
    }
    if (url.includes("/api/groups")) return { ok: true, json: async () => [] } as Response;
    throw new Error(`Unexpected fetch: ${url}`);
  }) as unknown as typeof fetch;
  return { resolveSimilarweb: (): void => resolveFetch() };
}

import { SitesTable } from "../SitesTable";

describe("SitesTable — Similarweb column and filter", () => {
  beforeEach(() => window.localStorage.clear());

  it("'No rank' filter shows a loading state (never a wrong list) until data arrives, then only unranked sites", async () => {
    const { resolveSimilarweb } = mockFetchWithPendingSimilarweb();
    render(<SitesTable sites={SITES} />);
    await screen.findByText("ranked.com");

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Similarweb filter"), "no");
    expect(screen.getByText("Loading Similarweb data…")).toBeInTheDocument();
    expect(screen.queryByText("ranked.com")).not.toBeInTheDocument();
    expect(screen.queryByText("unranked.com")).not.toBeInTheDocument();

    resolveSimilarweb();
    await waitFor(() => expect(screen.getByText("unranked.com")).toBeInTheDocument());
    expect(screen.queryByText("ranked.com")).not.toBeInTheDocument();
    expect(screen.queryByText("nodomain")).not.toBeInTheDocument();
  });

  it("cells show rank, no rank and no domain once loaded", async () => {
    const { resolveSimilarweb } = mockFetchWithPendingSimilarweb();
    render(<SitesTable sites={SITES} />);
    resolveSimilarweb();
    expect(await screen.findByText("#79,692 · 1.34M/mo")).toBeInTheDocument();
    const inCell = (text: string): boolean => screen.getAllByText(text).some((el) => el.closest("td") !== null);
    expect(inCell("No rank")).toBe(true);
    expect(inCell("No domain")).toBe(true);
  });
});

describe("SitesTable — Similarweb load failure", () => {
  it("says the data couldn't load instead of showing every site as never checked", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/sites/similarweb")) return { ok: false, status: 500, json: async () => ({ error: "boom" }) } as Response;
      if (url.includes("/api/groups")) return { ok: true, json: async () => [] } as Response;
      return { ok: true, json: async () => ({}) } as Response;
    }) as unknown as typeof fetch;
    render(<SitesTable sites={SITES} />);
    expect(await screen.findByText("Couldn't load Similarweb data")).toBeInTheDocument();
  });
});
