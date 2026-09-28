import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { GridPoolResponse } from "@/types/grid";
import { StoriesTable } from "../StoriesTable";

afterEach(cleanup);

const pool = (storyMode: GridPoolResponse["storyMode"]): GridPoolResponse => ({
  siteId: "g",
  generatedAt: "t",
  storyMode,
  perSiteLimit: 10,
  directoryGeneratedAt: "d",
  sources: [],
  inactivePins: [{ site: "a", slug: "old", reason: "expired" }],
  items: [
    { site: "a", slug: "s1", title: "Story one", publishDate: "2026-09-26T00:00:00Z", pills: [], pinned: true, summary: { status: "stale" } },
    { site: "b", slug: "s2", title: "Story two", publishDate: "2026-09-25T00:00:00Z", pills: [], pinned: false, summary: { status: "none" } },
  ],
});

describe("StoriesTable", () => {
  it("pin toggle calls back with the item", async () => {
    const onTogglePin = vi.fn();
    render(<StoriesTable pool={pool("excerpt")} onTogglePin={onTogglePin} onEdit={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Pin Story two" }));
    expect(onTogglePin).toHaveBeenCalledWith(expect.objectContaining({ slug: "s2" }));
    expect(screen.getByRole("button", { name: "Unpin Story one" })).toBeInTheDocument();
  });

  it("excerpt mode hides summary status and Edit", () => {
    render(<StoriesTable pool={pool("excerpt")} onTogglePin={vi.fn()} onEdit={vi.fn()} />);
    expect(screen.queryByText(/Stale/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Edit summary/ })).not.toBeInTheDocument();
  });

  it("AI mode shows status labels and Edit", async () => {
    const onEdit = vi.fn();
    render(<StoriesTable pool={pool("ai_summary")} onTogglePin={vi.fn()} onEdit={onEdit} />);
    const row = screen.getByText("Story one").closest("tr") as HTMLElement;
    expect(within(row).getByText("Stale — source changed after edit")).toBeInTheDocument();
    expect(screen.getByText("Excerpt fallback")).toBeInTheDocument();
    await userEvent.click(within(row).getByRole("button", { name: "Edit summary for Story one" }));
    expect(onEdit).toHaveBeenCalled();
  });

  it("lists inactive pins with reasons", () => {
    render(<StoriesTable pool={pool("excerpt")} onTogglePin={vi.fn()} onEdit={vi.fn()} />);
    expect(screen.getByText(/a\/old — expired/)).toBeInTheDocument();
  });

  it("AI mode renders a missing summary (not looked up) as — and status none as Excerpt fallback", () => {
    const p = pool("ai_summary");
    p.items.push({ site: "c", slug: "s3", title: "Story three", publishDate: "2026-09-24T00:00:00Z", pills: [], pinned: false });
    render(<StoriesTable pool={p} onTogglePin={vi.fn()} onEdit={vi.fn()} />);
    const three = screen.getByText("Story three").closest("tr") as HTMLElement;
    expect(within(three).getByText("—")).toBeInTheDocument();
    expect(within(three).queryByText("Excerpt fallback")).not.toBeInTheDocument();
    const two = screen.getByText("Story two").closest("tr") as HTMLElement;
    expect(within(two).getByText("Excerpt fallback")).toBeInTheDocument();
  });

  it("an inherited (group/override) pin shows a disabled Pinned by group button instead of Unpin", async () => {
    const onTogglePin = vi.fn();
    render(<StoriesTable pool={pool("excerpt")} onTogglePin={onTogglePin} onEdit={vi.fn()} isInheritedPin={(i): boolean => i.slug === "s1"} />);
    const btn = screen.getByRole("button", { name: "Pinned by group: Story one" });
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent("Pinned by group");
    expect(screen.queryByRole("button", { name: "Unpin Story one" })).not.toBeInTheDocument();
    await userEvent.click(btn);
    expect(onTogglePin).not.toHaveBeenCalled();
  });
});
