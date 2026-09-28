import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GridThemeFields } from "../GridThemeFields";

afterEach(cleanup);

describe("GridThemeFields", () => {
  it("renders every Grid colour, with inherit hints for Grid-only keys", () => {
    render(<GridThemeFields colors={{ accent: "#6c35bb" }} onChange={vi.fn()} />);
    expect(screen.getByText("Card background")).toBeInTheDocument();
    expect(screen.getAllByText(/Inherits Surface/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Must Reads/)).not.toBeInTheDocument();
  });

  it("'Use default' clears a Grid-only key (onChange with null)", async () => {
    const onChange = vi.fn();
    render(<GridThemeFields colors={{ card_bg: "#ffffff" }} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Use default for Card background" }));
    expect(onChange).toHaveBeenCalledWith("card_bg", null);
  });
});
