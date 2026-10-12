import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }) }));
const toast = vi.fn();
vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("@/lib/reference-data", () => ({ getVerticals: async () => [{ id: "1", name: "Travel", iab_code: "" }] }));

import { SiteAuthorsSection } from "../SiteAuthorsSection";
import type { AuthorListItem } from "@/lib/authors/types";

const mk = (id: string, name: string, extra: Partial<AuthorListItem> = {}): AuthorListItem => ({
  id, name, tagline: `${name} tagline`, bio: "b", beats: [], verticals: [], portrait: null, links: {}, exclusive_sites: [],
  created_at: "", updated_at: "", sites: [], ...extra,
});
const LIB = [
  mk("maya-ortiz", "Maya Ortiz", { verticals: ["Travel"], beats: ["Hiking"] }),
  mk("ella-hughes", "Ella Hughes", { exclusive_sites: ["scoopella"], beats: ["Royals"] }),
  mk("ben-foster", "Ben Foster", { beats: ["Celebrities"] }),
];
const saves: Array<Record<string, unknown>> = [];
const created: Array<Record<string, unknown>> = [];

function server(): void {
  global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    if (u === "/api/authors" && !init?.method) return new Response(JSON.stringify({ authors: LIB }), { status: 200 });
    if (u === "/api/authors" && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as { author: Record<string, unknown> };
      created.push(body.author);
      return new Response(JSON.stringify({ author: { ...body.author, id: "nia-okafor" } }), { status: 201 });
    }
    if (u === "/api/authors/generate") {
      const part = (JSON.parse(String(init!.body)) as { part: string }).part;
      const value = { name: "Nia Okafor", tagline: "Travel writer", bio: "Bio.", beats: ["Hiking", "Trails"], verticals: ["Travel"], portrait: { kind: "generated", path: "/authors/assets/nia-okafor-0123456789.webp" } }[part];
      return new Response(JSON.stringify({ status: "ok", value }), { status: 200 });
    }
    if (u === "/api/sites/save") {
      const body = JSON.parse(String(init!.body)) as { configUpdates: { authors: Array<{ id: string; topics: string[] }> } };
      saves.push(body.configUpdates as unknown as Record<string, unknown>);
      return new Response(JSON.stringify({ status: "ok", authors: body.configUpdates.authors.map((a) => ({ ...a, topics: a.topics.length ? a.topics : ["Hiking Trails"] })) }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;
}

const props = { domain: "journeypeaks", siteName: "Journey Peaks", vertical: "Travel", topics: ["Hiking Trails", "Road Trips"], initial: [] as Array<{ id: string; topics: string[] }>, legacyAuthor: "Ryan Rivera" };

beforeEach(() => { saves.length = 0; created.length = 0; toast.mockClear(); server(); });
afterEach(cleanup);

describe("SiteAuthorsSection", () => {
  it("with no authors it says who articles are credited to", async () => {
    render(<SiteAuthorsSection {...props} />);
    expect(await screen.findByText(/credited to Ryan Rivera/)).toBeTruthy();
  });

  it("Add author lists the best fits first with a hint; adding one and saving sends it and shows the split topics", async () => {
    render(<SiteAuthorsSection {...props} />);
    await userEvent.click(await screen.findByRole("button", { name: "Add from library" }));
    const options = within(screen.getByRole("listbox", { name: "Library authors" })).getAllByRole("option");
    expect(options[0]!.textContent).toMatch(/Maya Ortiz.*Good fit/);
    await userEvent.click(options[0]!);
    await userEvent.click(screen.getByRole("button", { name: "Save authors" }));
    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0]).toMatchObject({ authors: [{ id: "maya-ortiz", topics: [] }], confirmedExclusive: [] });
    const coverage = await screen.findByRole("list", { name: "Topic coverage" });
    expect(within(coverage).getByText("Hiking Trails").closest("li")!.textContent).toContain("Maya Ortiz");
  });

  it("an exclusive author needs a confirm, and the confirm is sent with the save", async () => {
    render(<SiteAuthorsSection {...props} />);
    await userEvent.click(await screen.findByRole("button", { name: "Add from library" }));
    await userEvent.click(screen.getByRole("option", { name: /Ella Hughes/ }));
    const dialog = screen.getByRole("dialog", { name: "Assign an exclusive author?" });
    expect(dialog.textContent).toMatch(/exclusive to scoopella/);
    await userEvent.click(within(dialog).getByRole("button", { name: "Assign" }));
    await userEvent.click(screen.getByRole("button", { name: "Save authors" }));
    await waitFor(() => expect(saves[0]).toMatchObject({ confirmedExclusive: ["ella-hughes"] }));
  });

  it("Create author for this site makes a dedicated author, shown as unsaved; Save creates it first, exclusive to the site", async () => {
    render(<SiteAuthorsSection {...props} />);
    await userEvent.click(await screen.findByRole("button", { name: "Create author" }));
    expect(await within(await screen.findByRole("list", { name: "Site authors" })).findByText("Nia Okafor", {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.getByText(/New, added to the library when you save/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Save authors" }));
    await waitFor(() => expect(saves).toHaveLength(1));
    expect(created[0]).toMatchObject({ name: "Nia Okafor", verticals: ["Travel"], exclusive_sites: ["journeypeaks"] });
    expect((saves[0]!.authors as Array<{ id: string }>).map((a) => a.id)).toEqual(["nia-okafor"]);
  });

  it("a failed site save doesn't create the new author twice on retry; after saving, the new author shows by name", async () => {
    let failSave = true;
    let posts = 0;
    let lib = [...LIB];
    global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      if (u === "/api/authors" && !init?.method) return new Response(JSON.stringify({ authors: lib }), { status: 200 });
      if (u === "/api/authors" && init?.method === "POST") {
        posts++;
        const a = { ...(JSON.parse(String(init.body)) as { author: AuthorListItem }).author, id: "nia-okafor", sites: [], created_at: "", updated_at: "" };
        lib = [...lib, a];
        return new Response(JSON.stringify({ author: a }), { status: 201 });
      }
      if (u === "/api/authors/generate") {
        const part = (JSON.parse(String(init!.body)) as { part: string }).part;
        const value = { name: "Nia Okafor", tagline: "Travel writer", bio: "Bio.", beats: ["Hiking", "Trails"], verticals: ["Travel"], portrait: { kind: "generated", path: "/authors/assets/nia-okafor-0123456789.webp" } }[part];
        return new Response(JSON.stringify({ status: "ok", value }), { status: 200 });
      }
      if (u === "/api/sites/save") {
        if (failSave) return new Response(JSON.stringify({ status: "error", message: "GitHub is down" }), { status: 500 });
        const b = JSON.parse(String(init!.body)) as { configUpdates: { authors: unknown } };
        return new Response(JSON.stringify({ status: "ok", authors: b.configUpdates.authors }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    }) as unknown as typeof fetch;
    render(<SiteAuthorsSection {...props} />);
    await userEvent.click(await screen.findByRole("button", { name: "Create author" }));
    await within(await screen.findByRole("list", { name: "Site authors" })).findByText("Nia Okafor", {}, { timeout: 3000 });
    await userEvent.click(screen.getByRole("button", { name: "Save authors" }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("GitHub is down", "error"));
    failSave = false;
    await userEvent.click(screen.getByRole("button", { name: "Save authors" }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Authors saved", "success"));
    expect(posts).toBe(1);
    expect(await screen.findByRole("link", { name: "Nia Okafor" })).toBeTruthy();
    expect(screen.queryByText("Not in the library")).toBeNull();
  });

  it("Save is available when the site's topics changed since the split (unassigned or removed topics)", async () => {
    render(<SiteAuthorsSection {...props} topics={["Hiking Trails", "Road Trips", "Cruises"]} initial={[{ id: "maya-ortiz", topics: ["Hiking Trails", "Road Trips", "Old Topic"] }]} />);
    await screen.findByRole("link", { name: "Maya Ortiz" });
    expect((screen.getByRole("button", { name: "Save authors" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("a server refusal about an exclusive author opens the confirm; Assign then saves with it confirmed", async () => {
    const bodies: Array<{ confirmedExclusive?: string[] }> = [];
    global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      if (u === "/api/authors" && !init?.method) return new Response(JSON.stringify({ authors: LIB }), { status: 200 });
      if (u === "/api/sites/save") {
        const b = (JSON.parse(String(init!.body)) as { configUpdates: { confirmedExclusive?: string[]; authors: unknown } }).configUpdates;
        bodies.push(b);
        return b.confirmedExclusive?.includes("ella-hughes")
          ? new Response(JSON.stringify({ status: "ok", authors: b.authors }), { status: 200 })
          : new Response(JSON.stringify({ status: "error", message: "Ella Hughes is exclusive to other sites. Confirm to assign.", exclusive: [{ id: "ella-hughes", name: "Ella Hughes", sites: ["scoopella"] }] }), { status: 409 });
      }
      return new Response("{}", { status: 404 });
    }) as unknown as typeof fetch;
    render(<SiteAuthorsSection {...props} initial={[{ id: "ella-hughes", topics: [] }, { id: "maya-ortiz", topics: [] }]} topics={[]} />);
    await screen.findByRole("link", { name: "Maya Ortiz" });
    await userEvent.click(screen.getByRole("button", { name: /Remove Maya Ortiz/ }));
    await userEvent.click(screen.getByRole("button", { name: "Save authors" }));
    const dialog = await screen.findByRole("dialog", { name: "Assign an exclusive author?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Assign" }));
    await userEvent.click(screen.getByRole("button", { name: "Save authors" }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Authors saved", "success"));
    expect(bodies[1]!.confirmedExclusive).toEqual(["ella-hughes"]);
    expect(screen.getAllByText("Ella Hughes")).toHaveLength(1);
  });

  it("coverage shows everyone covering a topic: a generalist shares every topic", async () => {
    render(<SiteAuthorsSection {...props} initial={[{ id: "maya-ortiz", topics: ["Hiking Trails"] }, { id: "ben-foster", topics: [] }]} />);
    const coverage = await screen.findByRole("list", { name: "Topic coverage" });
    await waitFor(() => expect(within(coverage).getByText("Hiking Trails").closest("li")!.textContent).toContain("Maya Ortiz, Ben Foster"));
    expect(within(coverage).getByText("Road Trips").closest("li")!.textContent).toContain("Ben Foster");
    expect((screen.queryByRole("button", { name: "Save authors" }))).toBeNull();
  });
});

