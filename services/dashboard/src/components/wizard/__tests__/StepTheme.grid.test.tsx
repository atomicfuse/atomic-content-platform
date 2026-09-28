import React from "react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StepTheme } from "../StepTheme";
import { makeWizardFormData } from "./wizard-test-data";

afterEach(cleanup);

describe("StepTheme — G4 template modes", () => {
  it("Modern: Layout section shown, no card look, no template picker", () => {
    render(<StepTheme data={makeWizardFormData()} onChange={vi.fn()} onNext={vi.fn()} onBack={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Layout" })).toBeInTheDocument();
    expect(screen.getByText("Show hero grid")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Card look" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Card style")).not.toBeInTheDocument();
    expect(screen.queryByRole("radiogroup", { name: "Site template" })).not.toBeInTheDocument();
    expect(screen.queryByText(/open its Grid tab/i)).not.toBeInTheDocument();
  });

  it("Grid: Layout hidden, card look shown; presets, fonts and assets kept", () => {
    render(
      <StepTheme data={makeWizardFormData({ template: "grid" })} onChange={vi.fn()} onNext={vi.fn()} onBack={vi.fn()} />,
    );
    expect(screen.queryByRole("heading", { name: "Layout" })).not.toBeInTheDocument();
    expect(screen.queryByText("Show hero grid")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Card look" })).toBeInTheDocument();
    expect(screen.getByLabelText("Card style")).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { name: "Typography" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "Assets (optional)" })).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup", { name: "Site template" })).not.toBeInTheDocument();
  });

  it("Grid: card look is bound to formData.card", async () => {
    const onChange = vi.fn();
    render(
      <StepTheme
        data={makeWizardFormData({ template: "grid", card: { corners: "square" } })}
        onChange={onChange}
        onNext={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Corners")).toHaveValue("square");
    await userEvent.selectOptions(screen.getByLabelText("Card style"), "flat");
    expect(onChange).toHaveBeenCalledWith({ card: { corners: "square", style: "flat" } });
  });
});
