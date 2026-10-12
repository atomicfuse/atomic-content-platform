import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/authors",
}));
const toast = vi.fn();
vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("@/lib/reference-data", () => ({ getVerticals: async () => [{ id: "1", name: "Travel", iab_code: "" }] }));

import { AuthorsPageClient } from "../AuthorsPageClient";

afterEach(() => { cleanup(); refresh.mockClear(); toast.mockClear(); });

const CONFIGS: Record<string, Record<string, unknown>> = {
  journeypeaks: { site_name: "Journey Peaks", brief: { vertical: "Travel", topics: ["Hiking"] } },
  scoopella: { site_name: "Scoopella", authors: [{ id: "ella-hughes", topics: [] }] },
  gridsite: { site_name: "Grid", theme: { template: "grid" } },
};

describe("Give every site an author", () => {
  it("creates one dedicated author per site without authors, skips the rest, and keeps going after the dialog closes", async () => {
    const createdFor: string[] = [];
    const saved: Array<{ domain: string; authors: unknown }> = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => { release = r; });
    global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      if (u === "/api/authors" && !init?.method) return new Response(JSON.stringify({ authors: [] }), { status: 200 });
      if (u.startsWith("/api/sites/site-config")) {
        const d = new URL(u, "http://x").searchParams.get("domain")!;
        return new Response(JSON.stringify({ config: CONFIGS[d] }), { status: 200 });
      }
      if (u === "/api/authors/generate") {
        await gate;
        const b = JSON.parse(String(init!.body)) as { part: string };
        const v = { name: "Nia Okafor", tagline: "t", bio: "b", beats: ["A", "B"], verticals: ["Travel"], portrait: { kind: "generated", path: "/authors/assets/nia-okafor-0123456789.webp" } }[b.part];
        return new Response(JSON.stringify({ status: "ok", value: v }), { status: 200 });
      }
      if (u === "/api/authors" && init?.method === "POST") {
        const a = (JSON.parse(String(init.body)) as { author: { exclusive_sites: string[] } }).author;
        createdFor.push(a.exclusive_sites[0]!);
        return new Response(JSON.stringify({ author: { id: "nia-okafor" } }), { status: 201 });
      }
      if (u === "/api/sites/save") {
        const b = JSON.parse(String(init!.body)) as { domain: string; configUpdates: { authors: unknown } };
        saved.push({ domain: b.domain, authors: b.configUpdates.authors });
        return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    }) as unknown as typeof fetch;

    render(<AuthorsPageClient authors={[]} sites={[{ domain: "journeypeaks", vertical: "Travel" }, { domain: "scoopella" }, { domain: "gridsite" }, { domain: "oldsite", status: "deleted" }]} />);
    await userEvent.click(screen.getByRole("button", { name: "Give every site an author" }));
    expect(screen.queryByRole("checkbox", { name: "oldsite" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Start (3 sites)" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect((screen.getByRole("button", { name: "Give every site an author" }) as HTMLButtonElement).disabled).toBe(true);
    release();
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Authors created for 1 site. 2 skipped (already had authors or Grid).", "success"));
    expect(createdFor).toEqual(["journeypeaks"]);
    expect(saved).toEqual([{ domain: "journeypeaks", authors: [{ id: "nia-okafor", topics: [] }] }]);
  });

  it("never replaces existing authors: the save is guarded; a refused save removes the author it made; unreadable sites need another try", async () => {
    const deleted: string[] = [];
    const saveBodies: Array<Record<string, unknown>> = [];
    global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      if (u === "/api/authors" && !init?.method) return new Response(JSON.stringify({ authors: [] }), { status: 200 });
      if (u.startsWith("/api/sites/site-config")) {
        const d = new URL(u, "http://x").searchParams.get("domain")!;
        return d === "broken" ? new Response(JSON.stringify({ error: "boom" }), { status: 500 }) : new Response(JSON.stringify({ config: { site_name: d } }), { status: 200 });
      }
      if (u === "/api/authors/generate") {
        const b = JSON.parse(String(init!.body)) as { part: string };
        const v = { name: "Nia Okafor", tagline: "t", bio: "b", beats: ["A", "B"], verticals: ["Travel"], portrait: { kind: "generated", path: "/authors/assets/nia-okafor-0123456789.webp" } }[b.part];
        return new Response(JSON.stringify({ status: "ok", value: v }), { status: 200 });
      }
      if (u === "/api/authors" && init?.method === "POST") return new Response(JSON.stringify({ author: { id: "nia-okafor" } }), { status: 201 });
      if (u.startsWith("/api/authors/") && init?.method === "DELETE") { deleted.push(u); return new Response(JSON.stringify({ ok: true }), { status: 200 }); }
      if (u === "/api/sites/save") {
        saveBodies.push(JSON.parse(String(init!.body)) as Record<string, unknown>);
        return new Response(JSON.stringify({ status: "error", code: "has-authors", message: "This site already has authors" }), { status: 409 });
      }
      return new Response("{}", { status: 404 });
    }) as unknown as typeof fetch;

    render(<AuthorsPageClient authors={[]} sites={[{ domain: "driftedsite" }, { domain: "broken" }]} />);
    await userEvent.click(screen.getByRole("button", { name: "Give every site an author" }));
    await userEvent.click(screen.getByRole("button", { name: "Start (2 sites)" }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Authors created for 0 sites. 1 skipped (already had authors or Grid). 1 need another try.", "info"));
    expect((saveBodies[0]!.configUpdates as Record<string, unknown>).onlyIfNoAuthors).toBe(true);
    expect(deleted).toEqual(["/api/authors/nia-okafor"]);
  });

  it("stops before creating anything when the author library can't be read (names could repeat)", async () => {
    global.fetch = vi.fn(async (url: RequestInfo | URL) => (String(url) === "/api/authors" ? new Response("{}", { status: 500 }) : new Response("{}", { status: 404 }))) as unknown as typeof fetch;
    render(<AuthorsPageClient authors={[]} sites={[{ domain: "a" }]} />);
    await userEvent.click(screen.getByRole("button", { name: "Give every site an author" }));
    await userEvent.click(screen.getByRole("button", { name: "Start (1 site)" }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Couldn't read the author library, so nothing was created. Try again.", "error"));
  });
});

