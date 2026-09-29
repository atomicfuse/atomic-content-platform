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
  makeSite({ domain: "atl-news", custom_domain: "atlnews.com" }),
  makeSite({ domain: "ngc-travel", custom_domain: "ngctravel.com", company: "NGC", vertical: "Travel" }),
  makeSite({ domain: "no-group-site", custom_domain: "nogroup.com" }),
];

const SITE_GROUPS: Record<string, string[]> = {
  "atl-news": ["ready"],
  "ngc-travel": [],
};

const AVAILABLE_GROUPS = [{ id: "ready", name: "Ready to Launch" }];

function mockFetch(): void {
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/sites/article-counts")) {
      return { ok: true, json: async () => ({}) } as Response;
    }
    if (url.includes("/api/sites/latest-articles")) {
      return { ok: true, json: async () => ({}) } as Response;
    }
    if (url.includes("/api/sites/groups")) {
      return { ok: true, json: async () => SITE_GROUPS } as Response;
    }
    if (url.includes("/api/groups")) {
      return { ok: true, json: async () => AVAILABLE_GROUPS } as Response;
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as unknown as typeof fetch;
}

/** Same as `mockFetch`, but `/api/sites/groups` stays pending until the
 *  returned `resolveGroups()` is called — used to exercise the window where
 *  a group filter is active but `siteGroups` is still `{}`. */
function mockFetchWithPendingGroups(): { resolveGroups: () => void } {
  let resolveGroupsFetch!: () => void;
  const groupsResponse = new Promise<Response>((resolve) => {
    resolveGroupsFetch = () => resolve({ ok: true, json: async () => SITE_GROUPS } as Response);
  });
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/sites/article-counts")) {
      return { ok: true, json: async () => ({}) } as Response;
    }
    if (url.includes("/api/sites/latest-articles")) {
      return { ok: true, json: async () => ({}) } as Response;
    }
    if (url.includes("/api/sites/groups")) {
      return groupsResponse;
    }
    if (url.includes("/api/groups")) {
      return { ok: true, json: async () => AVAILABLE_GROUPS } as Response;
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as unknown as typeof fetch;
  return { resolveGroups: (): void => resolveGroupsFetch() };
}

// Imported after the mocks above so SitesTable picks up the mocked modules.
import { SitesTable } from "../SitesTable";

describe("SitesTable — Group filter and Export CSV", () => {
  beforeEach(() => {
    mockFetch();
  });

  it("narrows the table to sites in the selected group", async () => {
    render(<SitesTable sites={SITES} />);

    // All three sites render before any filter is applied.
    expect(await screen.findByText("atlnews.com")).toBeInTheDocument();
    expect(screen.getByText("ngctravel.com")).toBeInTheDocument();
    expect(screen.getByText("nogroup.com")).toBeInTheDocument();

    // Wait for /api/sites/groups to resolve so the group dropdown is populated.
    await waitFor(() => {
      expect(screen.getByRole("option", { name: "Ready to Launch" })).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Group filter"), "ready");

    await waitFor(() => {
      expect(screen.queryByText("ngctravel.com")).not.toBeInTheDocument();
      expect(screen.queryByText("nogroup.com")).not.toBeInTheDocument();
    });
    expect(screen.getByText("atlnews.com")).toBeInTheDocument();
  });

  it("filters to ungrouped sites via the 'No group' option", async () => {
    render(<SitesTable sites={SITES} />);
    await screen.findByText("atlnews.com");
    await waitFor(() => {
      expect(screen.getByRole("option", { name: "Ready to Launch" })).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Group filter"), "__none__");

    await waitFor(() => {
      expect(screen.queryByText("atlnews.com")).not.toBeInTheDocument();
    });
    expect(screen.getByText("ngctravel.com")).toBeInTheDocument();
    expect(screen.getByText("nogroup.com")).toBeInTheDocument();
  });

  it("disables the Export CSV button once no sites match the filters", async () => {
    render(<SitesTable sites={SITES} />);
    await screen.findByText("atlnews.com");

    const exportButton = screen.getByRole("button", { name: /export csv/i });
    expect(exportButton).toBeEnabled();

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Search sites"), "no-such-domain-xyz");

    await waitFor(() => {
      expect(screen.getByText("No sites match your filters.")).toBeInTheDocument();
    });
    expect(exportButton).toBeDisabled();
  });

  it("shows a loading state instead of a (wrong) full list while groups are still loading, then the correct subset once resolved", async () => {
    const { resolveGroups } = mockFetchWithPendingGroups();
    render(<SitesTable sites={SITES} />);

    // Renders normally before any group filter is applied — /api/sites/groups
    // being pending doesn't block the initial table render.
    expect(await screen.findByText("atlnews.com")).toBeInTheDocument();

    // The "No group" sentinel option is static (not dependent on /api/groups),
    // so it's selectable even before either groups fetch resolves.
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Group filter"), "__none__");

    // siteGroups is still {} at this point, which would make every site look
    // ungrouped. Must show the loading state instead of that wrong full list.
    await waitFor(() => {
      expect(screen.getAllByText("Loading groups…").length).toBeGreaterThan(0);
    });
    expect(screen.queryByText("atlnews.com")).not.toBeInTheDocument();
    expect(screen.queryByText("ngctravel.com")).not.toBeInTheDocument();
    expect(screen.queryByText("nogroup.com")).not.toBeInTheDocument();
    expect(screen.queryByText("No sites match your filters.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /export csv/i })).toBeDisabled();

    // Resolve /api/sites/groups — the filter can now compute correctly.
    resolveGroups();

    await waitFor(() => {
      expect(screen.getByText("ngctravel.com")).toBeInTheDocument();
    });
    expect(screen.getByText("nogroup.com")).toBeInTheDocument();
    expect(screen.queryByText("atlnews.com")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /export csv/i })).toBeEnabled();
  });
});
