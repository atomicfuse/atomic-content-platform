import React from "react";
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StepGroups } from "../StepGroups";
import { makeWizardFormData } from "./wizard-test-data";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubGroups(groups: Array<Record<string, unknown>>): void {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(groups), { status: 200 })));
}

function renderStep(selected: string[] = []): ReturnType<typeof vi.fn> {
  const onChange = vi.fn();
  render(
    <StepGroups
      data={makeWizardFormData({ groups: selected })}
      onChange={onChange}
      onNext={vi.fn()}
      onBack={vi.fn()}
    />,
  );
  return onChange;
}

describe("StepGroups", () => {
  beforeEach(() => {
    // /api/groups returns the file name as `id`; current group YAMLs have no `group_id`.
    stubGroups([
      { id: "atl", name: "ATL" },
      { id: "ncg", name: "NCG" },
    ]);
  });

  it("selects only the clicked group when groups are identified by `id`", async () => {
    const onChange = renderStep();
    await userEvent.click(await screen.findByRole("button", { name: /ATL/ }));
    expect(onChange).toHaveBeenCalledWith({ groups: ["atl"] });
  });

  it("marks only the selected group as Selected", async () => {
    renderStep(["ncg"]);
    await screen.findByRole("button", { name: /ATL/ });
    expect(screen.getAllByText("Selected")).toHaveLength(1);
    expect(screen.getByRole("button", { name: /NCG/ })).toHaveTextContent("Selected");
  });

  it("still honours a legacy `group_id` field", async () => {
    stubGroups([{ id: "file-name", group_id: "legacy", name: "Legacy" }]);
    const onChange = renderStep();
    await userEvent.click(await screen.findByRole("button", { name: /Legacy/ }));
    expect(onChange).toHaveBeenCalledWith({ groups: ["legacy"] });
  });
});
