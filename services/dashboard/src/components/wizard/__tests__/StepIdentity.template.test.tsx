import React from "react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/hooks/useReferenceData", () => ({
  useAudiences: (): { audiences: never[]; loading: boolean } => ({ audiences: [], loading: false }),
  useVerticals: (): { verticals: never[]; loading: boolean } => ({ verticals: [], loading: false }),
}));

import { StepIdentity } from "../StepIdentity";
import { makeWizardFormData } from "./wizard-test-data";

afterEach(cleanup);

describe("StepIdentity — G1 template choice", () => {
  it("shows the template picker (Modern by default) after the name fields", () => {
    render(<StepIdentity data={makeWizardFormData()} onChange={vi.fn()} onNext={vi.fn()} onCancel={vi.fn()} />);
    const modern = screen.getByRole("radio", { name: /Modern/i });
    expect(modern).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: /Grid/i })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("Magazine layout: hero, must-reads, sections.")).toBeInTheDocument();
    expect(screen.getByText("Card-grid news feed of stories from other network sites.")).toBeInTheDocument();
    // Placed after the Site Name field.
    const siteName = screen.getByPlaceholderText("Cool News");
    expect(siteName.compareDocumentPosition(modern) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // No Grid hint line any more.
    expect(screen.queryByText(/open its Grid tab/i)).not.toBeInTheDocument();
  });

  it("clicking Grid calls onChange with template: grid", async () => {
    const onChange = vi.fn();
    render(<StepIdentity data={makeWizardFormData()} onChange={onChange} onNext={vi.fn()} onCancel={vi.fn()} />);
    await userEvent.click(screen.getByRole("radio", { name: /Grid/i }));
    expect(onChange).toHaveBeenCalledWith({ template: "grid" });
  });

  it("Modern still requires the AI site theme and shows the audience picker", () => {
    render(<StepIdentity data={makeWizardFormData({ theme: "" })} onChange={vi.fn()} onNext={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText("Site theme *")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search audiences...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Next/ })).toBeDisabled();
  });

  it("Grid hides the content-only fields and does not require a site theme", () => {
    render(
      <StepIdentity data={makeWizardFormData({ template: "grid", theme: "" })} onChange={vi.fn()} onNext={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.queryByText("Site theme *")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Search audiences...")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Next/ })).toBeEnabled();
  });
});
