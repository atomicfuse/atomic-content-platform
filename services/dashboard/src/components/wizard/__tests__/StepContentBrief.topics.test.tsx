import React, { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { WizardFormData } from "@/types/dashboard";
import { makeWizardFormData } from "./wizard-test-data";

vi.mock("@/actions/wizard", () => ({ suggestTopics: vi.fn() }));
vi.mock("@/hooks/useReferenceData", () => ({ useAudiences: () => ({ audiences: [] }) }));

import { suggestTopics } from "@/actions/wizard";
import { StepContentBrief } from "../StepContentBrief";

afterEach(() => { cleanup(); vi.mocked(suggestTopics).mockReset(); });

function Harness(): React.ReactElement {
  const [data, setData] = useState<WizardFormData>(makeWizardFormData({ siteName: "Scoopella" }));
  return <StepContentBrief data={data} onChange={(u): void => setData((d) => ({ ...d, ...u }))} onNext={vi.fn()} onBack={vi.fn()} />;
}

describe("StepContentBrief — topic suggestions", () => {
  it("regenerate asks for topics different from everything suggested so far, even after deleting them all", async () => {
    vi.mocked(suggestTopics)
      .mockResolvedValueOnce(["Royal Watch", "Street Style"])
      .mockResolvedValueOnce(["Celebrity Couples", "Red Carpet Looks"])
      .mockResolvedValueOnce(["Reality TV Drama", "Beauty Launches"]);
    render(<Harness />);
    expect(await screen.findByText("Royal Watch")).toBeInTheDocument();
    expect(vi.mocked(suggestTopics).mock.calls[0]![1] ?? []).toEqual([]);

    await userEvent.click(screen.getByRole("button", { name: /AI Suggest/ }));
    expect(await screen.findByText("Celebrity Couples")).toBeInTheDocument();
    expect(vi.mocked(suggestTopics).mock.calls[1]![1]).toEqual(["Royal Watch", "Street Style"]);

    // Delete every topic, then regenerate: earlier suggestions are still off-limits.
    for (const t of ["Celebrity Couples", "Red Carpet Looks"]) {
      await userEvent.click(screen.getByRole("button", { name: `Remove ${t}` }));
    }
    await userEvent.click(screen.getByRole("button", { name: /AI Suggest/ }));
    expect(await screen.findByText("Reality TV Drama")).toBeInTheDocument();
    expect(new Set(vi.mocked(suggestTopics).mock.calls[2]![1])).toEqual(new Set(["Royal Watch", "Street Style", "Celebrity Couples", "Red Carpet Looks"]));
  });

  it("says so when no new topics could be generated, keeping the current ones", async () => {
    vi.mocked(suggestTopics).mockResolvedValueOnce(["Royal Watch", "Street Style"]).mockResolvedValueOnce([]);
    render(<Harness />);
    await screen.findByText("Royal Watch");
    await userEvent.click(screen.getByRole("button", { name: /AI Suggest/ }));
    await waitFor(() => expect(screen.getByText(/couldn't come up with new topics/i)).toBeInTheDocument());
    expect(screen.getByText("Royal Watch")).toBeInTheDocument();
  });
});
