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
    await userEvent.click(screen.getByRole("checkbox", { name: "Medical Health" }));
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
