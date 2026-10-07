import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GridSettingsForm } from "../GridSettingsForm";

afterEach(cleanup);

describe("GridSettingsForm", () => {
  it("clearing a number removes the key (inherit), typing sets it", () => {
    const onChange = vi.fn();
    render(<GridSettingsForm value={{ per_site_limit: 10 }} onChange={onChange} sites={[]} verticals={[]} />);
    fireEvent.change(screen.getByLabelText("Articles per source site"), { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith({});
    fireEvent.change(screen.getByLabelText("Articles per source site"), { target: { value: "7" } });
    expect(onChange).toHaveBeenLastCalledWith({ per_site_limit: 7 });
  });

  it("story mode select writes story_mode", () => {
    const onChange = vi.fn();
    render(<GridSettingsForm value={{}} onChange={onChange} sites={[]} verticals={[]} />);
    fireEvent.change(screen.getByLabelText("Network stories"), { target: { value: "ai_summary" } });
    expect(onChange).toHaveBeenLastCalledWith({ story_mode: "ai_summary" });
  });

  it("preserves pinned (managed in the Stories tab) when editing other fields", () => {
    const onChange = vi.fn();
    const pinned = [{ site: "a", slug: "b" }];
    render(<GridSettingsForm value={{ pinned }} onChange={onChange} sites={[]} verticals={[]} />);
    fireEvent.change(screen.getByLabelText("Cards per page"), { target: { value: "24" } });
    expect(onChange).toHaveBeenLastCalledWith({ pinned, page_size: 24 });
  });
});

describe("GridSettingsForm — aggregator settings", () => {
  it("labels the existing story mode Network stories", () => {
    render(<GridSettingsForm value={{}} onChange={vi.fn()} sites={[]} verticals={[]} />);
    expect(screen.getByLabelText("Network stories")).toBeInTheDocument();
  });
  it("sets the aggregator story mode and the per-bundle limit", () => {
    const onChange = vi.fn();
    render(<GridSettingsForm value={{}} onChange={onChange} sites={[]} verticals={[]} />);
    fireEvent.change(screen.getByLabelText("Aggregator stories"), { target: { value: "ai_summary" } });
    expect(onChange).toHaveBeenLastCalledWith({ external_story_mode: "ai_summary" });
    fireEvent.change(screen.getByLabelText("Stories per bundle"), { target: { value: "15" } });
    expect(onChange).toHaveBeenLastCalledWith({ per_bundle_limit: 15 });
  });
  const CATS = [
    { id: "t1", name: "War and Conflicts", iab_code: "389", parent_id: null },
    { id: "s1", name: "Military Operations", iab_code: "x", parent_id: "t1" },
    { id: "t2", name: "Pop Culture", iab_code: "y", parent_id: null },
  ];
  it("blocks and unblocks aggregator categories (tier-1 and sub)", async () => {
    const onChange = vi.fn();
    const { rerender } = render(<GridSettingsForm value={{}} onChange={onChange} sites={[]} verticals={[]} categories={CATS} />);
    await userEvent.click(screen.getByRole("button", { name: "Add category" }));
    await userEvent.click(screen.getByRole("option", { name: /War and Conflicts/ }));
    expect(onChange).toHaveBeenLastCalledWith({ blocked_categories: ["War and Conflicts"] });
    await userEvent.type(screen.getByRole("searchbox", { name: "Search Blocked categories" }), "military");
    await userEvent.click(screen.getByRole("option", { name: /Military Operations/ }));
    expect(onChange).toHaveBeenLastCalledWith({ blocked_categories: ["Military Operations"] });
    rerender(<GridSettingsForm value={{ blocked_categories: ["War and Conflicts"] }} onChange={onChange} sites={[]} verticals={[]} categories={CATS} />);
    await userEvent.click(screen.getByRole("button", { name: "Remove War and Conflicts" }));
    expect(onChange).toHaveBeenLastCalledWith({});
  });
  it("keeps a blocked category the aggregator no longer lists visible so it can be cleared", () => {
    render(<GridSettingsForm value={{ blocked_categories: ["Gone"] }} onChange={vi.fn()} sites={[]} verticals={[]} categories={CATS} />);
    expect(screen.getByText("Gone (missing)")).toBeInTheDocument();
  });
});

describe("GridSettingsForm — blocked publishers", () => {
  it("adds a pasted link as a bare domain", async () => {
    const onChange = vi.fn();
    render(<GridSettingsForm value={{}} onChange={onChange} sites={[]} verticals={[]} />);
    await userEvent.type(screen.getByLabelText("Block a publisher"), "https://www.TheTruthSeeker.co.uk/article/123{Enter}");
    expect(onChange).toHaveBeenLastCalledWith({ blocked_domains: ["thetruthseeker.co.uk"] });
  });
  it("rejects text that isn't a domain, with a message", async () => {
    const onChange = vi.fn();
    render(<GridSettingsForm value={{}} onChange={onChange} sites={[]} verticals={[]} />);
    await userEvent.type(screen.getByLabelText("Block a publisher"), "not a site{Enter}");
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(/doesn't look like a website/i)).toBeInTheDocument();
  });
  it("lists blocked domains and removes one (empty list → key removed)", async () => {
    const onChange = vi.fn();
    render(<GridSettingsForm value={{ blocked_domains: ["x.com"] }} onChange={onChange} sites={[]} verticals={[]} />);
    await userEvent.click(screen.getByRole("button", { name: "Unblock x.com" }));
    expect(onChange).toHaveBeenLastCalledWith({});
  });
});
