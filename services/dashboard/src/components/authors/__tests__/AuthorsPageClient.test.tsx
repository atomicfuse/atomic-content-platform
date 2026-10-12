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

import { AuthorsPageClient } from "../AuthorsPageClient";
import type { AuthorListItem } from "@/lib/authors/types";

afterEach(() => { cleanup(); refresh.mockClear(); toast.mockClear(); });

const mk = (id: string, name: string): AuthorListItem => ({
  id, name, tagline: "Writer", bio: "", beats: ["A", "B"], portrait: { kind: "generated", path: `/authors/assets/${id}.webp` },
  links: {}, exclusive_sites: [], created_at: "", updated_at: "", sites: [],
});

describe("AuthorsPageClient: Generate missing profiles", () => {
  it("keeps running after the dialog closes, can't start twice, saves onto the latest version and refreshes per author", async () => {
    const puts: Array<{ id: string; author: Record<string, unknown> }> = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => { release = r; });
    global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/api/authors/generate")) {
        await gate;
        return new Response(JSON.stringify({ status: "ok", value: "A generated bio." }), { status: 200 });
      }
      const id = u.split("/").pop()!;
      if (init?.method === "PUT") {
        puts.push({ id, author: JSON.parse(String(init.body)).author });
        return new Response(JSON.stringify({ author: {} }), { status: 200 });
      }
      // GET: someone added a website in another tab after this page loaded.
      return new Response(JSON.stringify({ author: { ...mk(id, id), links: { website: "https://edited.example" } } }), { status: 200 });
    }) as unknown as typeof fetch;

    render(<AuthorsPageClient authors={[mk("ann-lee", "Ann Lee"), mk("bo-kim", "Bo Kim")]} sites={[]} />);
    await userEvent.click(screen.getByRole("button", { name: "Generate missing profiles (2)" }));
    await userEvent.click(screen.getByRole("button", { name: "Generate 2 profiles" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("status").textContent).toMatch(/Ann Lee/);
    expect((screen.getByRole("button", { name: /Generate missing profiles/ }) as HTMLButtonElement).disabled).toBe(true);

    release();
    await waitFor(() => expect(puts).toHaveLength(2));
    expect(puts[0]!.author).toMatchObject({ bio: "A generated bio.", links: { website: "https://edited.example" } });
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Profiles generated for 2 authors", "success"));
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
