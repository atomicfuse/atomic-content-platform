import React from "react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { StepGoLive } from "../StepGoLive";
import { makeWizardFormData } from "./wizard-test-data";

afterEach(cleanup);

function valueFor(label: string): string | null {
  return screen.getByText(label).nextElementSibling?.textContent ?? null;
}

describe("StepGoLive — G6 review summary", () => {
  it("Modern: unchanged summary (Articles/Day shown, no Grid lines)", () => {
    render(<StepGoLive data={makeWizardFormData({ articlesPerDay: 3 })} stagingResult={null} onBack={vi.fn()} />);
    expect(valueFor("Template")).toBe("modern");
    expect(valueFor("Articles/Day")).toBe("3");
    expect(screen.queryByText("Topic pills")).not.toBeInTheDocument();
    expect(screen.queryByText("Included sites")).not.toBeInTheDocument();
  });

  it("Grid: template, pill count with names, include/exclude counts; no Articles/Day", () => {
    render(
      <StepGoLive
        data={makeWizardFormData({
          template: "grid",
          grid: {
            topics: [
              { label: "Health", verticals: ["Health"] },
              { label: "Money", verticals: ["Finance"] },
            ],
            include_sites: ["a", "b", "c"],
            exclude_sites: ["d"],
          },
        })}
        stagingResult={null}
        onBack={vi.fn()}
      />,
    );
    expect(valueFor("Template")).toBe("Grid");
    expect(valueFor("Topic pills")).toBe("2: Health, Money");
    expect(valueFor("Included sites")).toBe("3");
    expect(valueFor("Excluded sites")).toBe("1");
    expect(screen.queryByText("Articles/Day")).not.toBeInTheDocument();
  });

  it("Grid with no pills or site lists shows zeros", () => {
    render(<StepGoLive data={makeWizardFormData({ template: "grid" })} stagingResult={null} onBack={vi.fn()} />);
    expect(valueFor("Topic pills")).toBe("0");
    expect(valueFor("Included sites")).toBe("0");
    expect(valueFor("Excluded sites")).toBe("0");
  });
});
