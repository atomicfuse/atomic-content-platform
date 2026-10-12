import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("@/hooks/useReferenceData", () => ({
  useAudiences: (): { audiences: never[]; loading: boolean } => ({ audiences: [], loading: false }),
  useVerticals: (): { verticals: never[]; loading: boolean } => ({ verticals: [], loading: false }),
}));

import { StepIdentity } from "../StepIdentity";
import { makeWizardFormData } from "./wizard-test-data";

afterEach(cleanup);

describe("StepIdentity — reserved site slugs", () => {
  it("says right away that 'authors' is reserved and blocks Next", () => {
    render(<StepIdentity data={makeWizardFormData({ pagesProjectName: "authors" })} onChange={vi.fn()} onNext={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText("“authors” is reserved by the platform — choose a different slug.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Next/ })).toBeDisabled();
  });
});
