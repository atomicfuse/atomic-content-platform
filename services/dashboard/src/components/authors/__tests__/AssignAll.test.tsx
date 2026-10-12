import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
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
import type { AuthorListItem } from "@/lib/authors/types";

afterEach(() => { cleanup(); refresh.mockClear(); toast.mockClear(); });

const SELIN: AuthorListItem = {
  id: "selin-aksoy", name: "Selin Aksoy", tagline: "t", bio: "b", beats: ["A", "B"], verticals: ["Travel"],
  portrait: { kind: "generated", path: "/authors/assets/selin-aksoy-0123456789.webp" }, links: {}, exclusive_sites: ["geekytraveler"],
  created_at: "", updated_at: "", sites: [{ site: "geekytraveler", topics: [] }],
};
const SITES = [
  { domain: "journeypeaks", vertical: "Travel" },
  { domain: "roadsandviews", vertical: "Travel" },
  { domain: "travelclearly", vertical: "Travel" },
  { domain: "geekytraveler", vertical: "Travel" },
  { domain: "scoopella", vertical: "Entertainment" },
  { domain: "tastereporter", vertical: "Food & Drink" },
];

interface Server { saves: Array<{ domain: string; updates: Record<string, unknown> }>; created: Array<Record<string, unknown>>; deleted: string[] }

function server(opts: { refuse?: string[]; unreadable?: string[]; libraryFails?: boolean } = {}): Server {
  const s: Server = { saves: [], created: [], deleted: [] };
  let n = 0;
  global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status });
    if (u === "/api/authors" && !init?.method) return opts.libraryFails ? json({}, 500) : json({ authors: [SELIN] });
    if (u.startsWith("/api/sites/site-config")) {
      const d = new URL(u, "http://x").searchParams.get("domain")!;
      return opts.unreadable?.includes(d) ? json({ error: "boom" }, 500) : json({ config: { site_name: d, brief: { vertical: "Travel", topics: [`${d} topic`] } } });
    }
    if (u === "/api/authors/generate") {
      const b = JSON.parse(String(init!.body)) as { part: string };
      const v = { name: `Writer ${n + 1}`, tagline: "t", bio: "b", beats: ["A", "B"], verticals: ["Travel"], portrait: { kind: "generated", path: "/authors/assets/w-0123456789.webp" } }[b.part];
      return json({ status: "ok", value: v });
    }
    if (u === "/api/authors" && init?.method === "POST") {
      n++;
      s.created.push((JSON.parse(String(init.body)) as { author: Record<string, unknown> }).author);
      return json({ author: { id: `writer-${n}` } }, 201);
    }
    if (u.startsWith("/api/authors/") && init?.method === "DELETE") { s.deleted.push(u); return json({ ok: true }); }
    if (u === "/api/sites/save") {
      const b = JSON.parse(String(init!.body)) as { domain: string; configUpdates: Record<string, unknown> };
      s.saves.push({ domain: b.domain, updates: b.configUpdates });
      return opts.refuse?.includes(b.domain) ? json({ status: "error", code: "has-authors", message: "This site already has authors" }, 409) : json({ status: "ok" });
    }
    return json({}, 404);
  }) as unknown as typeof fetch;
  return s;
}

async function openDialog(): Promise<HTMLElement> {
  await userEvent.click(screen.getByRole("button", { name: "Give every site an author" }));
  return screen.getByRole("dialog", { name: "Give every site an author" });
}

describe("Give every site an author: two sites per author", () => {
  it("previews the plan: existing authors take a second site, the rest are paired by category; scoopella is kept for Ella", async () => {
    server();
    render(<AuthorsPageClient authors={[SELIN]} sites={SITES} />);
    const dialog = await openDialog();
    expect((within(dialog).getByRole("checkbox", { name: /scoopella/ }) as HTMLInputElement).checked).toBe(false);
    expect(within(dialog).getByText(/Kept for Ella Hughes/)).toBeTruthy();
    expect((within(dialog).getByRole("checkbox", { name: /geekytraveler/ }) as HTMLInputElement).disabled).toBe(true);
    const plan = within(dialog).getByRole("list", { name: "Plan" });
    expect(within(plan).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "journeypeaks joins Selin Aksoy",
      "New author for roadsandviews and travelclearly",
      "New author for tastereporter",
    ]);
    expect(within(dialog).getByRole("button", { name: "Start (2 new authors, 1 join)" })).toBeTruthy();
  });

  it("runs the plan: joins with the exclusive confirm, one author per pair saved to both sites (not exclusive)", async () => {
    const s = server();
    render(<AuthorsPageClient authors={[SELIN]} sites={SITES} />);
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole("button", { name: /^Start/ }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Authors set for 4 sites (2 new authors).", "success"));
    expect(s.saves[0]).toEqual({ domain: "journeypeaks", updates: { authors: [{ id: "selin-aksoy", topics: [] }], onlyIfNoAuthors: true, confirmedExclusive: ["selin-aksoy"] } });
    expect(s.created[0]).toMatchObject({ name: "Writer 1", exclusive_sites: [] });
    expect(s.saves.filter((x) => (x.updates.authors as Array<{ id: string }>)[0]!.id === "writer-1").map((x) => x.domain)).toEqual(["roadsandviews", "travelclearly"]);
    expect(s.created[1]).toMatchObject({ exclusive_sites: [] });
  });

  it("never replaces existing authors; an author no site took is removed; unreadable sites need another try", async () => {
    const s = server({ refuse: ["roadsandviews", "travelclearly"], unreadable: ["tastereporter"] });
    render(<AuthorsPageClient authors={[SELIN]} sites={SITES} />);
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole("button", { name: /^Start/ }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Authors set for 1 site. 2 skipped (already had authors or Grid). 1 need another try.", "info"));
    expect(s.deleted).toEqual(["/api/authors/writer-1"]);
  });

  it("stops before creating anything when the author library can't be read", async () => {
    server({ libraryFails: true });
    render(<AuthorsPageClient authors={[SELIN]} sites={SITES} />);
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole("button", { name: /^Start/ }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Couldn't read the author library, so nothing was created. Try again.", "error"));
  });
});
