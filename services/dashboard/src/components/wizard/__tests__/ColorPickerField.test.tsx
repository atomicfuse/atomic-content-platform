import React from "react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ColorPickerField } from "../ColorPickerField";

afterEach(cleanup);

function hexInput(): HTMLInputElement {
  return screen.getByPlaceholderText("#1a1a2e or red") as HTMLInputElement;
}

describe("ColorPickerField", () => {
  it("shows the new hex code when the value changes from outside (theme preset applied)", () => {
    const { rerender } = render(<ColorPickerField label="Accent" value="#be185d" onChange={vi.fn()} />);
    expect(hexInput().value).toBe("#be185d");

    rerender(<ColorPickerField label="Accent" value="#7c3aed" onChange={vi.fn()} />);
    expect(hexInput().value).toBe("#7c3aed");
  });

  it("does not write the previous color back when the field is focused and left after a preset", async () => {
    const onChange = vi.fn();
    const { rerender } = render(<ColorPickerField label="Accent" value="#be185d" onChange={onChange} />);
    rerender(<ColorPickerField label="Accent" value="#7c3aed" onChange={onChange} />);

    const user = userEvent.setup();
    await user.click(hexInput());
    await user.tab();

    expect(onChange).not.toHaveBeenCalledWith("#be185d");
  });

  it("still commits a typed color on blur", async () => {
    const onChange = vi.fn();
    render(<ColorPickerField label="Accent" value="#be185d" onChange={onChange} />);
    const user = userEvent.setup();
    await user.clear(hexInput());
    await user.type(hexInput(), "#123456");
    await user.tab();
    expect(onChange).toHaveBeenLastCalledWith("#123456");
  });
});
