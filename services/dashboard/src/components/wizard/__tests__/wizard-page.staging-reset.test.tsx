import React from "react";
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/actions/wizard", () => ({
  suggestTopics: vi.fn().mockResolvedValue([]),
  createSiteAndBuildStaging: vi.fn(),
}));
vi.mock("@/hooks/useReferenceData", () => ({
  useAudiences: (): { audiences: never[]; loading: boolean } => ({ audiences: [], loading: false }),
  useVerticals: (): { verticals: Array<{ id: string; name: string }>; loading: boolean } => ({
    verticals: [{ id: "v-health", name: "Health" }],
    loading: false,
  }),
}));
// Stub Preview: stages on click and shows the result the page restores into it.
vi.mock("@/components/wizard/StepPreview", () => ({
  StepPreview: ({
    existingResult,
    onStagingResult,
  }: {
    existingResult: { stagingUrl: string; siteFolder: string } | null;
    onStagingResult: (r: { stagingUrl: string; siteFolder: string }) => void;
  }): React.ReactElement => (
    <div>
      <h2>Site Preview</h2>
      <p data-testid="existing-result">{existingResult?.stagingUrl ?? "none"}</p>
      <button type="button" onClick={(): void => onStagingResult({ stagingUrl: "https://old-grid", siteFolder: "gridsite" })}>
        stub-stage
      </button>
    </div>
  ),
}));

import WizardPage from "@/app/wizard/page";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (): Promise<Response> => new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function clickNext(): Promise<void> {
  await waitFor(() => expect(screen.getByRole("button", { name: /Next/ })).toBeEnabled());
  await userEvent.click(screen.getByRole("button", { name: /Next/ }));
}

/** From Create Site (Grid selected) walk Grid Feed → Groups → Theme → Preview. */
async function walkGridToPreview(addPill: boolean): Promise<void> {
  await clickNext();
  if (addPill) {
    await userEvent.click(screen.getByRole("button", { name: "Add topic" }));
    await userEvent.type(screen.getByPlaceholderText("e.g. Health"), "Health");
    await userEvent.click(screen.getByRole("checkbox", { name: "Health" }));
  }
  await clickNext(); // → Groups
  await clickNext(); // → Theme
  await clickNext(); // → Preview
  expect(screen.getByRole("heading", { name: "Site Preview" })).toBeInTheDocument();
}

async function stageThenBackToStart(): Promise<void> {
  render(<WizardPage />);
  await userEvent.type(screen.getByPlaceholderText("coolnews-dev-v2"), "gridsite");
  await userEvent.type(screen.getByPlaceholderText("Cool News"), "Grid Site");
  await userEvent.click(screen.getByRole("radio", { name: /Grid/i }));
  await walkGridToPreview(true);
  await userEvent.click(screen.getByRole("button", { name: "stub-stage" }));
  expect(screen.getByTestId("existing-result")).toHaveTextContent("https://old-grid");
  await userEvent.click(screen.getByRole("button", { name: "Create Site" }));
}

describe("WizardPage — staging result vs template changes", () => {
  it("keeps the staging result when the template is not changed", async () => {
    await stageThenBackToStart();
    // Re-selecting the current template is not a change.
    await userEvent.click(screen.getByRole("radio", { name: /Grid/i }));
    await walkGridToPreview(false);
    expect(screen.getByTestId("existing-result")).toHaveTextContent("https://old-grid");
  });

  it("clears the staging result when the template is switched after staging", async () => {
    await stageThenBackToStart();
    await userEvent.click(screen.getByRole("radio", { name: /Modern/i }));
    await userEvent.click(screen.getByRole("radio", { name: /Grid/i }));
    await walkGridToPreview(false);
    expect(screen.getByTestId("existing-result")).toHaveTextContent("none");
  });
});
