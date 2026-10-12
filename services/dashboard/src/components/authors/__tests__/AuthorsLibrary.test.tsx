import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const replace = vi.fn();
let search = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(search),
  usePathname: () => "/authors",
}));

import { AuthorsLibrary } from "../AuthorsLibrary";
import type { AuthorListItem } from "@/lib/authors/types";

afterEach(() => { cleanup(); replace.mockClear(); search = ""; });

const mk = (id: string, extra: Partial<AuthorListItem> = {}): AuthorListItem => ({
  id, name: id, tagline: "", bio: "Bio", beats: [], portrait: { kind: "generated", path: `/authors/assets/${id}.webp` },
  links: {}, exclusive_sites: [], created_at: "", updated_at: "", sites: [], ...extra,
});

describe("AuthorsLibrary", () => {
  it("cards link to the profile; exclusive and incomplete badges are text, not colour only", () => {
    render(<AuthorsLibrary authors={[mk("ella-hughes", { name: "Ella Hughes", exclusive_sites: ["scoopella"] }), mk("ben-foster", { name: "Ben Foster", portrait: null })]} />);
    const ella = screen.getByRole("link", { name: /Ella Hughes/ });
    expect(ella.getAttribute("href")).toBe("/authors/ella-hughes");
    expect(within(ella).getByText("Exclusive")).toBeTruthy();
    expect(within(screen.getByRole("link", { name: /Ben Foster/ })).getByText("Incomplete profile")).toBeTruthy();
  });

  it("filter chips and search are kept in the URL", async () => {
    render(<AuthorsLibrary authors={[mk("a")]} />);
    await userEvent.click(screen.getByRole("button", { name: /Exclusive/ }));
    expect(replace).toHaveBeenLastCalledWith("/authors?filter=exclusive", { scroll: false });
    await userEvent.type(screen.getByRole("searchbox", { name: "Search authors" }), "r");
    expect(replace).toHaveBeenLastCalledWith(expect.stringContaining("q=r"), { scroll: false });
  });

  it("restores state from the URL and shows a no-results state with a way out", () => {
    search = "q=nobody";
    render(<AuthorsLibrary authors={[mk("a")]} />);
    expect(screen.getByText("No authors match “nobody”")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Clear search and filters" })).toBeTruthy();
  });

  it("empty library explains how to start", () => {
    render(<AuthorsLibrary authors={[]} />);
    expect(screen.getByText("No authors yet")).toBeTruthy();
  });
});
