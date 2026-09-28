import React from "react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { GridFields } from "@/types/grid";
import type { WizardFormData } from "@/types/dashboard";

// Stub the data-fetching section: these tests cover the step's gating and binding.
vi.mock("@/components/config/grid/GridSettingsSection", () => ({
  GridSettingsSection: ({ value, onChange }: { value: GridFields; onChange: (g: GridFields) => void }): React.ReactElement => (
    <div>
      <p data-testid="grid-value">{JSON.stringify(value)}</p>
      <button type="button" onClick={(): void => onChange({ include_sites: ["foo"] })}>
        stub-include
      </button>
    </div>
  ),
}));

import { StepGridFeed, isGridFeedReady } from "../StepGridFeed";
import { makeWizardFormData } from "./wizard-test-data";

afterEach(cleanup);

function makeFormData(grid?: GridFields): WizardFormData {
  return makeWizardFormData({ template: "grid", grid });
}

const REASON = /Add a topic pill with a label and a vertical, or include at least one site/;

describe("isGridFeedReady", () => {
  it.each<[string, GridFields | undefined, boolean]>([
    ["unset", undefined, false],
    ["empty", {}, false],
    ["topic without vertical", { topics: [{ label: "Health", verticals: [] }] }, false],
    ["topic with blank label", { topics: [{ label: "  ", verticals: ["Health"] }] }, false],
    ["vertical on one topic, label on another", { topics: [{ label: "A", verticals: [] }, { label: "", verticals: ["V"] }] }, false],
    ["topic with label + vertical", { topics: [{ label: "Health", verticals: ["Health"] }] }, true],
    ["included site only", { include_sites: ["foo"] }, true],
    ["excluded site only", { exclude_sites: ["foo"] }, false],
  ])("%s → %s", (_name, grid, expected) => {
    expect(isGridFeedReady(grid)).toBe(expected);
  });
});

describe("StepGridFeed", () => {
  it("shows the heading and intro copy", () => {
    render(<StepGridFeed data={makeFormData()} onChange={vi.fn()} onNext={vi.fn()} onBack={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Grid Feed" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Choose the topic pills and which network sites feed them. Stories come from Live sites in the selected verticals.",
      ),
    ).toBeInTheDocument();
  });

  it("disables Next with a reason line until the feed has a source", async () => {
    const onNext = vi.fn();
    render(<StepGridFeed data={makeFormData({ topics: [{ label: "Health", verticals: [] }] })} onChange={vi.fn()} onNext={onNext} onBack={vi.fn()} />);
    const next = screen.getByRole("button", { name: /Next/ });
    expect(next).toBeDisabled();
    expect(screen.getByText(REASON)).toBeInTheDocument();
    await userEvent.click(next);
    expect(onNext).not.toHaveBeenCalled();
  });

  it("enables Next and hides the reason once a topic has a label and a vertical", async () => {
    const onNext = vi.fn();
    render(<StepGridFeed data={makeFormData({ topics: [{ label: "Health", verticals: ["Health"] }] })} onChange={vi.fn()} onNext={onNext} onBack={vi.fn()} />);
    expect(screen.queryByText(REASON)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Next/ }));
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("binds the settings form to formData.grid and Back calls onBack", async () => {
    const onChange = vi.fn();
    const onBack = vi.fn();
    render(<StepGridFeed data={makeFormData({ per_site_limit: 5 })} onChange={onChange} onNext={vi.fn()} onBack={onBack} />);
    expect(screen.getByTestId("grid-value")).toHaveTextContent('{"per_site_limit":5}');
    await userEvent.click(screen.getByRole("button", { name: "stub-include" }));
    expect(onChange).toHaveBeenCalledWith({ grid: { include_sites: ["foo"] } });
    await userEvent.click(screen.getByRole("button", { name: /Back/ }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
