import React from "react";
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SiteThemeTab } from "../SiteThemeTab";
import { ToastProvider } from "@/components/ui/Toast";

afterEach(cleanup);

// Same rationale as SiteThemeTab.grid.test.tsx: resolve next/dynamic
// synchronously so the lazily-loaded Grid components render in jsdom.
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

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
}));

function mockFetchFor(template: "modern" | "grid"): void {
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/sites/site-config")) {
      return {
        ok: true,
        json: async () => ({
          config: { theme: { template, base: "classic", colors: {} } },
          inheritance: { org: null, groups: [] },
        }),
      } as Response;
    }
    if (url.includes("/api/sites/save")) {
      return { ok: true, json: async () => ({ status: "ok" }) } as Response;
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as unknown as typeof fetch;
}

describe("SiteThemeTab — F2 refresh after template change", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refresh.mockClear();
  });

  it("calls router.refresh() after a save that changes the template (modern -> grid)", async () => {
    mockFetchFor("modern");
    render(
      <ToastProvider>
        <SiteThemeTab domain="example.com" />
      </ToastProvider>,
    );

    await screen.findByText("Must Reads background");
    await userEvent.click(screen.getByRole("radio", { name: /Grid/i }));

    const saveButton = await screen.findByRole("button", { name: "Save Theme" });
    await waitFor(() => expect(saveButton).toBeEnabled());
    await userEvent.click(saveButton);

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Saved. The Grid tab is now available.")).toBeInTheDocument();
  });

  it("does not call router.refresh() after a save that does not change the template", async () => {
    mockFetchFor("modern");
    render(
      <ToastProvider>
        <SiteThemeTab domain="example.com" />
      </ToastProvider>,
    );

    await screen.findByText("Must Reads background");
    // Change something other than the template (header logo height slider)
    // so the Save button becomes enabled without touching theme.template.
    const [logoHeightSlider] = screen.getAllByRole("slider");
    fireEvent.change(logoHeightSlider!, { target: { value: "60" } });

    const saveButton = await screen.findByRole("button", { name: "Save Theme" });
    await waitFor(() => expect(saveButton).toBeEnabled());
    await userEvent.click(saveButton);

    await waitFor(() =>
      expect(
        screen.getByText("Theme saved — changes will appear on the staging site in a few minutes"),
      ).toBeInTheDocument(),
    );
    expect(refresh).not.toHaveBeenCalled();
  });
});
