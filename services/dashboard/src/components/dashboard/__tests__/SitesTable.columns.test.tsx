import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DashboardSiteEntry } from "@/types/dashboard";
import { COLUMN_STORAGE_KEY } from "@/lib/site-columns";

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

const SITES = [makeSite({ domain: "atl-news", custom_domain: "atlnews.com" })];

let liveConfigCallCount = 0;

function mockFetch(): void {
  liveConfigCallCount = 0;
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/sites/article-counts")) {
      return { ok: true, json: async () => ({}) } as Response;
    }
    if (url.includes("/api/sites/latest-articles")) {
      return { ok: true, json: async () => ({}) } as Response;
    }
    if (url.includes("/api/sites/groups")) {
      return { ok: true, json: async () => ({}) } as Response;
    }
    if (url.includes("/api/groups")) {
      return { ok: true, json: async () => [] } as Response;
    }
    if (url.includes("/api/sites/live-config")) {
      liveConfigCallCount += 1;
      return {
        ok: true,
        json: async () => ({
          "atl-news": {
            template: "grid",
            ga4: "G-123",
            facebook_pixel: null,
            gtm: null,
            google_ads: null,
            articles_per_day: 2,
            publish_days: null,
            last_synced_at: "2026-01-05T00:00:00Z",
          },
        }),
      } as Response;
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as unknown as typeof fetch;
}

// Imported after the mocks above so SitesTable picks up the mocked modules.
import { SitesTable } from "../SitesTable";

async function openChooser(): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /columns/i }));
  return user;
}

describe("SitesTable — column chooser", () => {
  beforeEach(() => {
    mockFetch();
    window.localStorage.clear();
  });

  it("does not show any optional columns in the chooser's checked state changing the default table render", async () => {
    render(<SitesTable sites={SITES} />);
    await screen.findByText("atlnews.com");
    // Default view: Template (a hidden-by-default column) is not rendered as a header.
    expect(screen.queryByRole("columnheader", { name: /template/i })).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /^company$/i })).toBeInTheDocument();
  });

  it("toggling a column in the chooser shows it, and unticking hides it again", async () => {
    render(<SitesTable sites={SITES} />);
    await screen.findByText("atlnews.com");

    const user = await openChooser();
    const templateCheckbox = screen.getByRole("checkbox", { name: /template/i });
    expect(templateCheckbox).not.toBeChecked();

    await user.click(templateCheckbox);
    await waitFor(() => {
      expect(screen.getByRole("columnheader", { name: /template/i })).toBeInTheDocument();
    });

    // The popover stays open across a checkbox click (only Escape/outside
    // click closes it) — the checkbox is still on screen to untick.
    const checkboxAfter = screen.getByRole("checkbox", { name: /template/i });
    expect(checkboxAfter).toBeChecked();
    await user.click(checkboxAfter);

    await waitFor(() => {
      expect(screen.queryByRole("columnheader", { name: /template/i })).not.toBeInTheDocument();
    });
  });

  it("persists the visible-column choice across a remount", async () => {
    const { unmount } = render(<SitesTable sites={SITES} />);
    await screen.findByText("atlnews.com");

    const user = await openChooser();
    await user.click(screen.getByRole("checkbox", { name: /custom domain/i }));
    await waitFor(() => {
      expect(screen.getByRole("columnheader", { name: /custom domain/i })).toBeInTheDocument();
    });

    unmount();
    cleanup();
    mockFetch();

    render(<SitesTable sites={SITES} />);
    // The fixture's custom_domain matches its own Website cell text, and
    // Custom domain is now visible too — expect it at least once rather
    // than uniquely.
    await waitFor(() => {
      expect(screen.getAllByText("atlnews.com").length).toBeGreaterThan(0);
    });
    await waitFor(() => {
      expect(screen.getByRole("columnheader", { name: /custom domain/i })).toBeInTheDocument();
    });
  });

  it("falls back to the default columns when localStorage.getItem throws", async () => {
    const spy = vi.spyOn(window.localStorage.__proto__, "getItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });

    render(<SitesTable sites={SITES} />);
    await screen.findByText("atlnews.com");
    await waitFor(() => {
      expect(screen.getByRole("columnheader", { name: /^company$/i })).toBeInTheDocument();
    });
    expect(screen.queryByRole("columnheader", { name: /template/i })).not.toBeInTheDocument();

    spy.mockRestore();
  });

  it('"Reset to default" restores the default column set after changes', async () => {
    render(<SitesTable sites={SITES} />);
    await screen.findByText("atlnews.com");

    const user = await openChooser();
    await user.click(screen.getByRole("checkbox", { name: /custom domain/i }));
    await waitFor(() => {
      expect(screen.getByRole("columnheader", { name: /custom domain/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /reset to default/i }));
    await waitFor(() => {
      expect(screen.queryByRole("columnheader", { name: /custom domain/i })).not.toBeInTheDocument();
    });
    expect(screen.getByRole("columnheader", { name: /^company$/i })).toBeInTheDocument();
    expect(
      JSON.parse(window.localStorage.getItem(COLUMN_STORAGE_KEY) ?? "[]"),
    ).toEqual([
      "company",
      "group",
      "category",
      "status",
      "articles",
      "lastArticles",
      "siteId",
      "created",
      "lastUpdated",
    ]);
  });

  it("closes the popover on Escape", async () => {
    render(<SitesTable sites={SITES} />);
    await screen.findByText("atlnews.com");
    const user = await openChooser();
    expect(screen.getByRole("menu")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });
  });

  it("does not fetch /api/sites/live-config until a live column is enabled, then fetches it exactly once", async () => {
    render(<SitesTable sites={SITES} />);
    await screen.findByText("atlnews.com");
    expect(liveConfigCallCount).toBe(0);

    const user = await openChooser();
    await user.click(screen.getByRole("checkbox", { name: /template/i }));

    await waitFor(() => {
      expect(liveConfigCallCount).toBe(1);
    });

    await waitFor(() => {
      expect(within(screen.getByText("atlnews.com").closest("tr")!).getByText("Grid")).toBeInTheDocument();
    });

    // Toggling the same (or another) live column off and back on must not
    // trigger a second fetch — the result is fetched once per mount. The
    // chooser popover stays open across a checkbox click, so reuse it.
    await user.click(screen.getByRole("checkbox", { name: /template/i }));
    await waitFor(() => {
      expect(screen.queryByRole("columnheader", { name: /template/i })).not.toBeInTheDocument();
    });
    await user.click(screen.getByRole("checkbox", { name: /template/i }));
    await waitFor(() => {
      expect(screen.getByRole("columnheader", { name: /template/i })).toBeInTheDocument();
    });

    expect(liveConfigCallCount).toBe(1);
  });

  it("disables Export CSV while live data is still loading for a visible live column", async () => {
    let resolveLiveConfig!: () => void;
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/sites/article-counts") || url.includes("/api/sites/latest-articles")) {
        return { ok: true, json: async () => ({}) } as Response;
      }
      if (url.includes("/api/sites/groups")) {
        return { ok: true, json: async () => ({}) } as Response;
      }
      if (url.includes("/api/groups")) {
        return { ok: true, json: async () => [] } as Response;
      }
      if (url.includes("/api/sites/live-config")) {
        return new Promise<Response>((resolve) => {
          resolveLiveConfig = () => resolve({ ok: true, json: async () => ({}) } as Response);
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    render(<SitesTable sites={SITES} />);
    await screen.findByText("atlnews.com");

    const exportButton = screen.getByRole("button", { name: /export csv/i });
    expect(exportButton).toBeEnabled();

    const user = await openChooser();
    await user.click(screen.getByRole("checkbox", { name: /template/i }));

    await waitFor(() => {
      expect(exportButton).toBeDisabled();
    });

    resolveLiveConfig();
    await waitFor(() => {
      expect(exportButton).toBeEnabled();
    });
  });
});
