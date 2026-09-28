import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GridCardLookFields } from "../GridCardLookFields";

afterEach(cleanup);

describe("GridCardLookFields", () => {
  it("shows defaults and emits a merged value on change", async () => {
    const onChange = vi.fn();
    render(<GridCardLookFields value={{ corners: "small" }} onChange={onChange} />);
    expect(screen.getByLabelText("Card style")).toHaveValue("bordered");
    await userEvent.selectOptions(screen.getByLabelText("Card style"), "shadow");
    expect(onChange).toHaveBeenCalledWith({ corners: "small", style: "shadow" });
  });
});
