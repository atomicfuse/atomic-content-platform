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

  it("excerpt mode still shows summary status (per-story overrides work in any mode); Edit only where a summary exists", () => {
    render(<StoriesTable pool={pool("excerpt")} onTogglePin={vi.fn()} onEdit={vi.fn()} />);
    expect(screen.getByRole("columnheader", { name: "Summary" })).toBeInTheDocument();
    expect(screen.getByText("Stale — source changed after edit")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit summary for Story one" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit summary for Story two" })).not.toBeInTheDocument();
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

describe("StoriesTable — aggregator stories and per-story AI summary", () => {
  const ID = "a".repeat(24);
  const external = { site: "aggregator", slug: `batman-${ID}`, title: "Batman paused", publishDate: "2026-09-26T00:00:00Z", pills: [], pinned: false, kind: "external" as const, sourceName: "Daily Mail", summary: { status: "none" as const } };
  const withItems = (items: GridPoolResponse["items"]): GridPoolResponse => ({ ...pool("excerpt"), inactivePins: [], items });

  it("badges external stories with the publisher and labels their default text What It Covers", () => {
    render(<StoriesTable pool={withItems([external])} onTogglePin={vi.fn()} onEdit={vi.fn()} onUseAiSummary={vi.fn()} onBackToDefault={vi.fn()} />);
    expect(screen.getByText("External · Daily Mail")).toBeInTheDocument();
    expect(screen.getByText("What It Covers")).toBeInTheDocument();
  });

  it("offers Use AI summary when not pinned and Back to default when pinned", async () => {
    const onUse = vi.fn();
    const onBack = vi.fn();
    const { rerender } = render(<StoriesTable pool={withItems([external])} onTogglePin={vi.fn()} onEdit={vi.fn()} onUseAiSummary={onUse} onBackToDefault={onBack} />);
    await userEvent.click(screen.getByRole("button", { name: "Use AI summary for Batman paused" }));
    expect(onUse).toHaveBeenCalledWith(external);
    const pinned = { ...external, summary: { status: "generated" as const, pinned: true } };
    rerender(<StoriesTable pool={withItems([pinned])} onTogglePin={vi.fn()} onEdit={vi.fn()} onUseAiSummary={onUse} onBackToDefault={onBack} />);
    expect(screen.getByText("AI summary (set manually)")).toBeInTheDocument();
    expect(screen.queryByText(/pinned/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Back to default for Batman paused" }));
    expect(onBack).toHaveBeenCalledWith(pinned);
  });

  it("hides the per-story actions when the callbacks are not provided", () => {
    render(<StoriesTable pool={withItems([external])} onTogglePin={vi.fn()} onEdit={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /Use AI summary/ })).not.toBeInTheDocument();
  });
});

describe("StoriesTable — per-story AI summary feedback", () => {
  const ID = "b".repeat(24);
  const ext = { site: "aggregator", slug: `story-${ID}`, title: "Ext story", publishDate: "2026-09-26T00:00:00Z", pills: [], pinned: false, kind: "external" as const, sourceName: "tmz.com", summary: { status: "none" as const } };
  const p = (items: GridPoolResponse["items"], storyMode: GridPoolResponse["storyMode"] = "excerpt"): GridPoolResponse => ({ ...pool(storyMode), inactivePins: [], items });

  it("explains what the per-story action does", () => {
    render(<StoriesTable pool={p([ext])} onTogglePin={vi.fn()} onEdit={vi.fn()} onUseAiSummary={vi.fn()} onBackToDefault={vi.fn()} />);
    expect(screen.getByText(/gives one story its own AI summary/)).toBeInTheDocument();
  });

  it("disables the row's button while its summary is generating", () => {
    render(<StoriesTable pool={p([ext])} onTogglePin={vi.fn()} onEdit={vi.fn()} onUseAiSummary={vi.fn()} onBackToDefault={vi.fn()} isBusy={(i): boolean => i.slug === ext.slug} />);
    expect(screen.getByRole("button", { name: "Use AI summary for Ext story" })).toBeDisabled();
  });

  it("shows a syncing state right after a summary was created", () => {
    render(<StoriesTable pool={p([ext])} onTogglePin={vi.fn()} onEdit={vi.fn()} onUseAiSummary={vi.fn()} onBackToDefault={vi.fn()} isSyncing={(): boolean => true} />);
    expect(screen.getByText("AI summary · syncing")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Use AI summary for Ext story" })).not.toBeInTheDocument();
  });

  it("labels a network story's default text Excerpt in excerpt mode (not 'Excerpt fallback')", () => {
    const net = { site: "a", slug: "n1", title: "Net story", publishDate: "2026-09-26T00:00:00Z", pills: [], pinned: false, summary: { status: "none" as const } };
    render(<StoriesTable pool={p([net], "excerpt")} onTogglePin={vi.fn()} onEdit={vi.fn()} />);
    expect(screen.getByText("Excerpt")).toBeInTheDocument();
    expect(screen.queryByText("Excerpt fallback")).not.toBeInTheDocument();
  });
});

describe("StoriesTable — hiding stories", () => {
  it("Hide calls back with the item", async () => {
    const onHide = vi.fn();
    render(<StoriesTable pool={pool("excerpt")} onTogglePin={vi.fn()} onEdit={vi.fn()} onHide={onHide} onUnhide={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Hide Story two" }));
    expect(onHide).toHaveBeenCalledWith(expect.objectContaining({ slug: "s2" }));
  });
  it("leaves hidden stories out of the table and lists them under Hidden with Unhide", async () => {
    const onUnhide = vi.fn();
    const hidden = [{ site: "b", slug: "s2", title: "Story two" }, { site: "aggregator", slug: "gone-6ac4931364df7692b392bfce", title: "Old external" }];
    render(
      <StoriesTable
        pool={pool("excerpt")} onTogglePin={vi.fn()} onEdit={vi.fn()} onHide={vi.fn()} onUnhide={onUnhide}
        hidden={hidden} isHidden={(i): boolean => i.slug === "s2"}
      />,
    );
    expect(screen.queryByRole("button", { name: "Pin Story two" })).not.toBeInTheDocument();
    expect(screen.getByText("Hidden from this site (2)")).toBeInTheDocument();
    expect(screen.getByText("Old external")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Unhide Story two" }));
    expect(onUnhide).toHaveBeenCalledWith(hidden[0]);
  });
});
