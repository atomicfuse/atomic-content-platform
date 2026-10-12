import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DashboardSiteEntry } from "@/types/dashboard";
import { COLUMN_STORAGE_KEY } from "@/lib/site-columns";

afterEach(cleanup);

vi.mock("@/hooks/useReferenceData", () => ({
  useVerticals: () => ({ verticals: [{ id: "v-travel", name: "Travel", iab_code: "" }, { id: "v-news", name: "News", iab_code: "" }], loading: false }),
}));
vi.mock("@/actions/sites", () => ({ deleteSiteEntry: vi.fn(), updateSiteEntry: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }), usePathname: () => "/sites", useSearchParams: () => new URLSearchParams("") }));

const SITE: DashboardSiteEntry = {
  domain: "atl-news", company: "ATL", vertical: "News", status: "Live", site_id: "site_123", exclusivity: null, ob_epid: null,
  ga_info: null, cf_apo: false, fixed_ad: false, last_updated: "2026-01-01T00:00:00Z", created_at: "2025-06-15T00:00:00Z",
  pages_project: null, pages_subdomain: null, zone_id: null, staging_branch: "staging/atl-news", preview_url: null, saved_previews: null,
  custom_domain: "atlnews.com",
} as DashboardSiteEntry;

const saves: Array<Record<string, unknown>> = [];

function mockFetch(): void {
  saves.length = 0;
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const json = (body: unknown): Response => ({ ok: true, status: 200, json: async () => body }) as Response;
    if (url.includes("/api/sites/article-counts") || url.includes("/api/sites/latest-articles") || url.includes("/api/sites/groups") || url.includes("/api/sites/similarweb")) return json({});
    if (url.includes("/api/groups")) return json([]);
    if (url.includes("/api/sites/live-config")) return json({ "atl-news": { template: "modern", ga4: "G-123", facebook_pixel: null, gtm: null, google_ads: null, articles_per_day: 1, publish_days: null, last_synced_at: null } });
    if (url.includes("/api/sites/site-config")) return json({ config: { tracking: { ga4: "G-123" } }, inheritance: { org: { tracking: { ga4: "G-ORG" } }, groups: [] } });
    if (url.includes("/api/sites/save")) { saves.push(JSON.parse(String(init!.body)) as Record<string, unknown>); return json({ status: "ok" }); }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as unknown as typeof fetch;
}

import { SitesTable } from "../SitesTable";

beforeEach(() => {
  mockFetch();
  window.localStorage.clear();
  window.localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(["company", "category", "status", "ga4", "gtm", "facebookPixel"]));
});

describe("SitesTable inline editing: category and tracking", () => {
  it("category: pick from the network's categories and save it to the site", async () => {
    const user = userEvent.setup();
    render(<SitesTable sites={[SITE]} />);
    await user.click(await screen.findByRole("button", { name: "Change category for atl-news" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Category for atl-news" }), "v-travel");
    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0]).toMatchObject({ domain: "atl-news", configUpdates: { verticalId: "v-travel", vertical: "Travel" } });
    expect(await screen.findByRole("button", { name: "Change category for atl-news" })).toHaveTextContent("Travel");
  });

  it("GA4: the dialog shows what's in effect and what's inherited, checks the format, then saves the site's own ID", async () => {
    const user = userEvent.setup();
    render(<SitesTable sites={[SITE]} />);
    await user.click(await screen.findByRole("button", { name: "Edit Google Analytics for atl-news" }));
    const dialog = await screen.findByRole("dialog", { name: "Google Analytics for atl-news" });
    expect(await within(dialog).findByText("G-ORG", { selector: "dd span" })).toBeInTheDocument();
    expect(within(dialog).getByText(/from organization/)).toBeInTheDocument();
    const input = within(dialog).getByLabelText("Google Analytics ID");
    await user.clear(input);
    await user.type(input, "UA-1");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent(/G-/);
    expect(saves).toHaveLength(0);
    await user.clear(input);
    await user.type(input, "g-new123");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0]).toMatchObject({ domain: "atl-news", configUpdates: { tracking: { ga4: "G-NEW123" } } });
    const cell = await screen.findByRole("button", { name: "Edit Google Analytics for atl-news" });
    expect(cell).toHaveTextContent("G-NEW123");
    expect(cell).toHaveTextContent(/not published/i);
  });

  it("Use inherited clears the site's own ID (null), so the inherited one applies", async () => {
    const user = userEvent.setup();
    render(<SitesTable sites={[SITE]} />);
    await user.click(await screen.findByRole("button", { name: "Edit Google Analytics for atl-news" }));
    const dialog = await screen.findByRole("dialog", { name: "Google Analytics for atl-news" });
    await user.click(await within(dialog).findByRole("button", { name: "Use inherited (G-ORG)" }));
    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0]).toMatchObject({ configUpdates: { tracking: { ga4: null } } });
    expect(await screen.findByRole("button", { name: "Edit Google Analytics for atl-news" })).toHaveTextContent("G-ORG");
  });
});
