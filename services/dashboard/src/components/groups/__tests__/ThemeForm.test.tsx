import React from "react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeForm } from "../ThemeForm";

afterEach(cleanup);

describe("ThemeForm — F3 dead Theme dropdown removal", () => {
  it("no longer renders a Theme select", () => {
    render(<ThemeForm value={{ theme: "modern" }} onChange={vi.fn()} />);
    expect(screen.queryByRole("combobox", { name: /theme/i })).not.toBeInTheDocument();
    expect(screen.queryByText("Editorial")).not.toBeInTheDocument();
    expect(
      screen.getByText("Template (Modern / Grid) is chosen per site in Site Settings → Theme."),
    ).toBeInTheDocument();
  });

  it("passes through an existing theme.theme value unchanged when editing another field", async () => {
    const onChange = vi.fn();
    render(
      <ThemeForm value={{ theme: "modern", heading_font: "" }} onChange={onChange} />,
    );

    // The Heading Font input has no `htmlFor`/`id` association with its label
    // (pre-existing markup, unrelated to this fix), so target it by its
    // placeholder — it's the first of the two "Inter"-placeholder inputs
    // (heading, then body).
    await userEvent.type(screen.getAllByPlaceholderText("Inter")[0]!, "I");

    expect(onChange).toHaveBeenCalled();
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1]![0] as Record<
      string,
      unknown
    >;
    expect(lastCall.theme).toBe("modern");
    expect(lastCall.heading_font).toBe("I");
  });
});
