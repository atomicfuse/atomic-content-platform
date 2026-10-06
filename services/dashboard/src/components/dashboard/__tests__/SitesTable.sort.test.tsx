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

// Input order differs from every sorted order, so "sort off" is observable.
const SITES = [
  makeSite({ domain: "c-site", custom_domain: "charlie.com", vertical: "Food" }),
  makeSite({ domain: "b-site", custom_domain: "bravo.com", vertical: "Travel" }),
  makeSite({ domain: "a-site", custom_domain: "alpha.com", vertical: "entertainment" }),
];
const NAMES = ["alpha.com", "bravo.com", "charlie.com"];

const SITE_GROUPS: Record<string, string[]> = {
  "b-site": ["zeta"],
  "a-site": ["alpha-g"],
  "c-site": [],
};

const AVAILABLE_GROUPS = [
  { id: "zeta", name: "Zeta" },
  { id: "alpha-g", name: "Alpha Group" },
];

function mockFetch(): void {
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/sites/article-counts")) return { ok: true, json: async () => ({}) } as Response;
    if (url.includes("/api/sites/latest-articles")) return { ok: true, json: async () => ({}) } as Response;
    if (url.includes("/api/sites/groups")) return { ok: true, json: async () => SITE_GROUPS } as Response;
    if (url.includes("/api/groups")) return { ok: true, json: async () => AVAILABLE_GROUPS } as Response;
    throw new Error(`Unexpected fetch: ${url}`);
  }) as unknown as typeof fetch;
}

/** Visible site order, read from the table body rows. */
function rowOrder(): string[] {
  return screen
    .getAllByRole("row")
    .slice(1)
    .map((row) => NAMES.find((n) => row.textContent?.includes(n)))
    .filter((n): n is string => !!n);
}

// Imported after the mocks above so SitesTable picks up the mocked modules.
import { SitesTable } from "../SitesTable";

describe("SitesTable — sort by Group and Category", () => {
  beforeEach(() => {
    mockFetch();
  });

  async function renderLoaded(): Promise<ReturnType<typeof userEvent.setup>> {
    render(<SitesTable sites={SITES} />);
    await screen.findByText("alpha.com");
    await waitFor(() => {
      expect(screen.getByRole("option", { name: "Zeta" })).toBeInTheDocument();
    });
    return userEvent.setup();
  }

  it("sorts by group name, ungrouped sites last, and cycles asc → desc → off", async () => {
    const user = await renderLoaded();
    const header = screen.getByRole("button", { name: "Group" });

    await user.click(header);
    expect(rowOrder()).toEqual(["alpha.com", "bravo.com", "charlie.com"]);

    await user.click(header);
    expect(rowOrder()).toEqual(["bravo.com", "alpha.com", "charlie.com"]);

    // Third click turns sorting off — back to the original order.
    await user.click(header);
    expect(rowOrder()).toEqual(["charlie.com", "bravo.com", "alpha.com"]);
  });

  it("sorts by category case-insensitively", async () => {
    const user = await renderLoaded();
    const header = screen.getByRole("button", { name: "Category" });

    await user.click(header);
    expect(rowOrder()).toEqual(["alpha.com", "charlie.com", "bravo.com"]);

    await user.click(header);
    expect(rowOrder()).toEqual(["bravo.com", "charlie.com", "alpha.com"]);
  });

  it("only one column is sorted at a time", async () => {
    const user = await renderLoaded();
    await user.click(screen.getByRole("button", { name: "Category" }));
    await user.click(screen.getByRole("button", { name: "Group" }));
    expect(rowOrder()).toEqual(["alpha.com", "bravo.com", "charlie.com"]);
  });
});
