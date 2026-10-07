import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
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
  it("blocks and unblocks aggregator sources", () => {
    const onChange = vi.fn();
    const { rerender } = render(<GridSettingsForm value={{}} onChange={onChange} sites={[]} verticals={[]} sources={["Conspiracy", "InStyle"]} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Conspiracy" }));
    expect(onChange).toHaveBeenLastCalledWith({ blocked_sources: ["Conspiracy"] });
    rerender(<GridSettingsForm value={{ blocked_sources: ["Conspiracy"] }} onChange={onChange} sites={[]} verticals={[]} sources={["Conspiracy", "InStyle"]} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Conspiracy" }));
    expect(onChange).toHaveBeenLastCalledWith({});
  });
});
