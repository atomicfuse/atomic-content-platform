import React from "react";
import { describe, expect, it, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WizardShell } from "../WizardShell";

afterEach(cleanup);

const STEPS = ["One", "Two", "Three"] as const;

function renderShell(): void {
  render(
    <WizardShell steps={STEPS}>
      {({ currentStep, stepName, goNext }): React.ReactNode => (
        <div>
          <p data-testid="step">{`${currentStep}:${stepName}`}</p>
          <button type="button" onClick={goNext}>
            next
          </button>
        </div>
      )}
    </WizardShell>,
  );
}

describe("WizardShell — custom steps prop", () => {
  it("renders one tab per supplied step and starts on the first", () => {
    renderShell();
    for (const s of STEPS) expect(screen.getByRole("button", { name: s })).toBeInTheDocument();
    expect(screen.getByTestId("step")).toHaveTextContent("0:One");
    expect(screen.getByRole("button", { name: "Two" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Three" })).toBeDisabled();
  });

  it("advances, clamps at the last step and only allows going back to completed steps", async () => {
    renderShell();
    const next = screen.getByRole("button", { name: "next" });
    await userEvent.click(next);
    await userEvent.click(next);
    await userEvent.click(next);
    expect(screen.getByTestId("step")).toHaveTextContent("2:Three");

    await userEvent.click(screen.getByRole("button", { name: "One" }));
    expect(screen.getByTestId("step")).toHaveTextContent("0:One");
    expect(screen.getByRole("button", { name: "Three" })).toBeDisabled();
  });
});
