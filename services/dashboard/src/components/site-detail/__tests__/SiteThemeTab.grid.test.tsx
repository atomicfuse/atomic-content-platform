import React from "react";
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SiteThemeTab } from "../SiteThemeTab";

afterEach(cleanup);

// Resolve next/dynamic synchronously so the lazily-loaded Grid components
// render in jsdom without waiting on a real code-split chunk. SiteThemeTab's
// loaders already unwrap to the component itself (`.then((m) => m.X)`), so
// the resolved value here IS the component, not a module namespace.
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

describe("SiteThemeTab — Grid template", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders Grid colour + card-look fields in Grid mode and saves theme_template/theme_card", async () => {
    mockFetchFor("grid");
    render(<SiteThemeTab domain="example.com" />);

    expect(await screen.findByText("Card background")).toBeInTheDocument();
    expect(screen.queryByText("Must Reads background")).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText("Card style"), "shadow");

    const saveButton = await screen.findByRole("button", { name: "Save Theme" });
    await waitFor(() => expect(saveButton).toBeEnabled());
    await userEvent.click(saveButton);

    await waitFor(() => {
      const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls as Array<
        [string, { body?: string } | undefined]
      >;
      const saveCall = calls.find(([url]) => url.includes("/api/sites/save"));
      expect(saveCall).toBeDefined();
      const body = JSON.parse(saveCall![1]!.body as string) as {
        configUpdates: { theme_template?: string; theme_card?: unknown };
      };
      expect(body.configUpdates.theme_template).toBe("grid");
      expect(body.configUpdates.theme_card).toEqual({ style: "shadow" });
    });
  });

  it("renders Modern colour fields (not Grid fields) in Modern mode", async () => {
    mockFetchFor("modern");
    render(<SiteThemeTab domain="example.com" />);

    expect(await screen.findByText("Must Reads background")).toBeInTheDocument();
    expect(screen.queryByText("Card background")).not.toBeInTheDocument();
  });
});
