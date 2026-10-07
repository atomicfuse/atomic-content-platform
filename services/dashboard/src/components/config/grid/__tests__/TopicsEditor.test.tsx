import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TopicsEditor } from "../TopicsEditor";

afterEach(cleanup);

describe("TopicsEditor", () => {
  const verticals = ["Travel", "Healthy Living", "Medical Health"];

  it("adds a topic", async () => {
    const onChange = vi.fn();
    render(<TopicsEditor value={[]} onChange={onChange} verticals={verticals} />);
    await userEvent.click(screen.getByRole("button", { name: "Add topic" }));
    expect(onChange).toHaveBeenCalledWith([{ label: "", verticals: [] }]);
  });

  it("toggles a vertical on a topic", async () => {
    const onChange = vi.fn();
    render(
      <TopicsEditor
        value={[{ label: "Health", verticals: ["Healthy Living"] }]}
        onChange={onChange}
        verticals={verticals}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Add vertical to Health" }));
    await userEvent.click(screen.getByRole("option", { name: /Medical Health/ }));
    expect(onChange).toHaveBeenCalledWith([{ label: "Health", verticals: ["Healthy Living", "Medical Health"] }]);
  });

  it("moves and removes topics", async () => {
    const onChange = vi.fn();
    render(
      <TopicsEditor
        value={[
          { label: "A", verticals: [] },
          { label: "B", verticals: [] },
        ]}
        onChange={onChange}
        verticals={verticals}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Move B up" }));
    expect(onChange).toHaveBeenLastCalledWith([
      { label: "B", verticals: [] },
      { label: "A", verticals: [] },
    ]);
    await userEvent.click(screen.getByRole("button", { name: "Remove A" }));
    expect(onChange).toHaveBeenLastCalledWith([{ label: "B", verticals: [] }]);
  });
});

describe("TopicsEditor — aggregator bundles", () => {
  it("adds a bundle to a pill", async () => {
    const onChange = vi.fn();
    render(<TopicsEditor value={[{ label: "Celebs", verticals: [] }]} onChange={onChange} verticals={[]} bundles={[{ id: "b1", name: "Scoopella", count: 347 }]} />);
    await userEvent.click(screen.getByRole("button", { name: "Add bundle to Celebs" }));
    await userEvent.click(screen.getByRole("option", { name: /Scoopella/ }));
    expect(onChange).toHaveBeenCalledWith([{ label: "Celebs", verticals: [], bundles: ["b1"] }]);
  });
  it("removing the last bundle drops the key", async () => {
    const onChange = vi.fn();
    render(<TopicsEditor value={[{ label: "Celebs", verticals: [], bundles: ["b1"] }]} onChange={onChange} verticals={[]} bundles={[{ id: "b1", name: "Scoopella", count: 347 }]} />);
    await userEvent.click(screen.getByRole("button", { name: "Remove Scoopella · 347" }));
    expect(onChange).toHaveBeenCalledWith([{ label: "Celebs", verticals: [] }]);
  });
  it("shows a bundle the aggregator no longer has, so it can be cleared", () => {
    render(<TopicsEditor value={[{ label: "X", verticals: [], bundles: ["gone"] }]} onChange={vi.fn()} verticals={[]} bundles={[]} />);
    expect(screen.getByText("gone (missing)")).toBeInTheDocument();
  });
});
