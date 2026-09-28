import React from "react";
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { GridFields } from "@/types/grid";
import { GridSiteTab } from "../GridSiteTab";

afterEach(cleanup);

// Resolve next/dynamic synchronously so the lazily-loaded Grid components
// render in jsdom without waiting on a real code-split chunk. See
// SiteThemeTab.grid.test.tsx for the same pattern.
vi.mock("next/dynamic", () => ({
  default: (loader: () => Promise<React.ComponentType<Record<string, unknown>>>) => {
    const Loaded = (props: Record<string, unknown>): React.ReactElement | null => {
      const [Mod, setMod] = React.useState<React.ComponentType<Record<string, unknown>> | null>(null);
      React.useEffect(() => {
        let cancelled = false;
        void loader().then((component) => {
          if (!cancelled) setMod(() => component);
        });
        return (): void => {
          cancelled = true;
        };
      }, []);
      return Mod ? <Mod {...props} /> : null;
    };
    return Loaded;
  },
}));

// Replace the real Feed-settings form (which fetches its own reference data)
// with a single numeric field wired straight to onChange, so the test can
// simulate an in-progress, unsaved settings edit.
vi.mock("@/components/config/grid/GridSettingsSection", () => ({
  GridSettingsSection: ({ value, onChange }: { value: GridFields; onChange: (next: GridFields) => void }) => (
    <input
      aria-label="Page size"
      type="number"
      value={value.page_size ?? ""}
      onChange={(e): void => onChange({ ...value, page_size: Number(e.target.value) || undefined })}
    />
  ),
}));

function mockFetch(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/sites/site-config")) {
      return {
        ok: true,
        json: async () => ({ config: { grid: { page_size: 12, pinned: [] } } }),
      } as Response;
    }
    if (url.includes("/api/grid/pool")) {
      return {
        ok: true,
        json: async () => ({
          siteId: "example.com",
          generatedAt: "t",
          storyMode: "excerpt",
          perSiteLimit: 10,
          directoryGeneratedAt: null,
          sources: [],
          inactivePins: [],
          items: [
            {
              site: "example.com",
              slug: "hello-world",
              title: "Hello World",
              publishDate: "2026-09-20T00:00:00Z",
              pills: [],
              pinned: false,
            },
          ],
        }),
      } as Response;
    }
    if (url.includes("/api/sites/save")) {
      return { ok: true, json: async () => ({ status: "ok" }) } as Response;
    }
    throw new Error(`Unexpected fetch: ${url} ${init?.method ?? ""}`);
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

describe("GridSiteTab — pinning does not commit unsaved Feed settings", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("Pin persists only the pin change, not an in-progress Feed-settings edit", async () => {
    const fetchMock = mockFetch();
    render(<GridSiteTab domain="example.com" />);

    const pageSizeInput = await screen.findByLabelText("Page size");
    expect(pageSizeInput).toHaveValue(12);

    // Edit a Feed-settings field but never click "Save Grid settings".
    await userEvent.clear(pageSizeInput);
    await userEvent.type(pageSizeInput, "40");
    expect(pageSizeInput).toHaveValue(40);

    const pinButton = await screen.findByRole("button", { name: "Pin Hello World" });
    await userEvent.click(pinButton);

    await waitFor(() => {
      const saveCall = fetchMock.mock.calls.find(([reqInput, reqInit]) => {
        const u = typeof reqInput === "string" ? reqInput : (reqInput as URL).toString();
        return u.includes("/api/sites/save") && (reqInit as RequestInit | undefined)?.method === "POST";
      });
      expect(saveCall).toBeDefined();
      const body = JSON.parse((saveCall![1] as RequestInit).body as string) as {
        configUpdates: { grid: GridFields };
      };
      expect(body.configUpdates.grid.pinned).toEqual([{ site: "example.com", slug: "hello-world", until: null }]);
      // The unsaved page_size edit (40) must NOT have been committed by the pin save.
      expect(body.configUpdates.grid.page_size).toBe(12);
    });

    // The Feed-settings field itself keeps showing the user's unsaved edit.
    expect(pageSizeInput).toHaveValue(40);
  });
});

describe("GridSiteTab — inherited pins", () => {
  it("a pool item pinned by a group (not in the site's grid.pinned) shows a disabled Pinned by group button", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/sites/site-config")) {
        return { ok: true, json: async () => ({ config: { grid: { pinned: [{ site: "a.com", slug: "own", until: null }] } } }) } as Response;
      }
      if (url.includes("/api/grid/pool")) {
        return {
          ok: true,
          json: async () => ({
            siteId: "example.com", generatedAt: "t", storyMode: "excerpt", perSiteLimit: 10, directoryGeneratedAt: null, sources: [], inactivePins: [],
            items: [
              { site: "a.com", slug: "own", title: "Own pin", publishDate: "2026-09-20T00:00:00Z", pills: [], pinned: true },
              { site: "b.com", slug: "grp", title: "Group pin", publishDate: "2026-09-20T00:00:00Z", pills: [], pinned: true },
            ],
          }),
        } as Response;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    render(<GridSiteTab domain="example.com" />);

    const groupBtn = await screen.findByRole("button", { name: "Pinned by group: Group pin" });
    expect(groupBtn).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Unpin Group pin" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unpin Own pin" })).toBeEnabled();
    await userEvent.click(groupBtn);
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/api/sites/save"))).toBe(false);
  });
});
