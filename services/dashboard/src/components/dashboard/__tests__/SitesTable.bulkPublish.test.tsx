import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
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

// Never load the real publish server action.
const publishMock = vi.fn();
vi.mock("@/actions/wizard", () => ({
  publishStagingToProduction: (...args: unknown[]) => publishMock(...args),
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
    preview_url: null,
    saved_previews: null,
    custom_domain: null,
    ...overrides,
  };
}

function mockFetch(): void {
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url === "/api/sites/pending-changes") {
      return {
        ok: true,
        status: 200,
        json: async () => ({ scannedAt: "x", scanned: 2, sites: [], errors: [] }),
      } as Response;
    }
    if (url.includes("/api/groups")) return { ok: true, json: async () => [] } as Response;
    return { ok: true, json: async () => ({}) } as Response;
  }) as unknown as typeof fetch;
}

import { SitesTable } from "../SitesTable";

describe("SitesTable: Publish changes toolbar button", () => {
  beforeEach(() => {
    mockFetch();
    window.localStorage.clear();
  });

  it("opens the bulk publish modal and scans only when clicked", async () => {
    const user = userEvent.setup();
    render(
      <SitesTable
        sites={[
          makeSite({ domain: "live-one" }),
          makeSite({ domain: "ready-one", status: "Ready" }),
          makeSite({ domain: "wip", status: "Staging" }),
        ]}
      />,
    );
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock.mock.calls.some((c) => String(c[0]) === "/api/sites/pending-changes")).toBe(false);

    await user.click(screen.getByRole("button", { name: /publish changes/i }));
    expect(await screen.findByText("No sites have unpublished changes")).toBeInTheDocument();
    expect(fetchMock.mock.calls.some((c) => String(c[0]) === "/api/sites/pending-changes")).toBe(true);
    expect(publishMock).not.toHaveBeenCalled();
  });

  it("is disabled when no site is Ready/Live with a staging branch", () => {
    render(<SitesTable sites={[makeSite({ status: "Staging" }), makeSite({ domain: "x", staging_branch: null })]} />);
    expect(screen.getByRole("button", { name: /publish changes/i })).toBeDisabled();
  });
});

describe("SitesTable: Publish changes while a bulk publish is finishing", () => {
  beforeEach(() => {
    mockFetch();
    window.localStorage.clear();
  });

  it("disables the button with a tooltip while busy, and re-enables it when the run finishes", async () => {
    const { setBulkPublishBusy } = await import("@/lib/bulk-publish-activity");
    setBulkPublishBusy(true);
    render(<SitesTable sites={[makeSite({ domain: "live-one" })]} />);
    const button = screen.getByRole("button", { name: /publish changes/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "A bulk publish is still finishing…");

    act(() => setBulkPublishBusy(false));
    expect(button).toBeEnabled();
    expect(button).not.toHaveAttribute("title", "A bulk publish is still finishing…");
  });
});
