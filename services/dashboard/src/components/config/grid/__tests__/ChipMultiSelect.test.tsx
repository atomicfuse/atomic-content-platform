import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChipMultiSelect, type ChipOption } from "../ChipMultiSelect";

afterEach(cleanup);

const OPTIONS: ChipOption[] = [
  { value: "War and Conflicts", label: "War and Conflicts" },
  { value: "Military Operations", label: "Military Operations", group: "War and Conflicts" },
  { value: "Pop Culture", label: "Pop Culture" },
];

function setup(value: string[] = []): ReturnType<typeof vi.fn> {
  const onChange = vi.fn();
  render(<ChipMultiSelect label="Blocked categories" addLabel="Add category" value={value} options={OPTIONS} onChange={onChange} />);
  return onChange;
}

describe("ChipMultiSelect", () => {
  it("shows only selected values as chips, not every option", () => {
    setup(["Pop Culture"]);
    expect(screen.getByText("Pop Culture")).toBeInTheDocument();
    expect(screen.queryByText("Military Operations")).not.toBeInTheDocument();
  });

  it("adds from a searchable list and keeps it open for the next pick", async () => {
    const onChange = setup();
    await userEvent.click(screen.getByRole("button", { name: "Add category" }));
    await userEvent.type(screen.getByRole("searchbox", { name: "Search Blocked categories" }), "mili");
    expect(screen.queryByRole("option", { name: /Pop Culture/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("option", { name: /Military Operations/ }));
    expect(onChange).toHaveBeenCalledWith(["Military Operations"]);
    expect(screen.getByRole("searchbox", { name: "Search Blocked categories" })).toBeInTheDocument();
  });

  it("does not offer already-selected values", async () => {
    setup(["Pop Culture"]);
    await userEvent.click(screen.getByRole("button", { name: "Add category" }));
    expect(screen.queryByRole("option", { name: /Pop Culture/ })).not.toBeInTheDocument();
  });

  it("removes a chip", async () => {
    const onChange = setup(["Pop Culture", "War and Conflicts"]);
    await userEvent.click(screen.getByRole("button", { name: "Remove Pop Culture" }));
    expect(onChange).toHaveBeenCalledWith(["War and Conflicts"]);
  });

  it("keeps a selected value the options no longer contain, marked missing", () => {
    setup(["Gone"]);
    expect(screen.getByText("Gone (missing)")).toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Add category" }));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  });
});
