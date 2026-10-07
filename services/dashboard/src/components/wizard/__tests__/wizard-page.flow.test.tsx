import React from "react";
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/actions/wizard", () => ({
  suggestTopics: vi.fn().mockResolvedValue(["Topic A", "Topic B"]),
  createSiteAndBuildStaging: vi.fn(),
}));
vi.mock("@/hooks/useReferenceData", () => ({
  useAudiences: (): { audiences: never[]; loading: boolean } => ({ audiences: [], loading: false }),
  // Grid settings (Blocked categories picker).
  useAllCategories: (): { categories: never[]; loading: boolean } => ({ categories: [], loading: false }),
  useVerticals: (): { verticals: Array<{ id: string; name: string }>; loading: boolean } => ({
    verticals: [{ id: "v-health", name: "Health" }],
    loading: false,
  }),
  // Used by the Content Brief step (Modern only).
  useCategories: (): { categories: never[]; loading: boolean } => ({ categories: [], loading: false }),
}));

import WizardPage from "@/app/wizard/page";
import { suggestTopics } from "@/actions/wizard";

const MODERN = ["Create Site", "Content Brief", "Topic Filters", "Groups", "Theme", "Preview", "Review"];
const GRID = ["Create Site", "Grid Feed", "Groups", "Theme", "Preview", "Review"];

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (): Promise<Response> => new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function tabNames(): string[] {
  // Step tabs are the first buttons, inside the tab strip (first child of the shell).
  const strip = screen.getByRole("button", { name: "Create Site" }).parentElement!;
  return within(strip)
    .getAllByRole("button")
    .map((b) => b.textContent ?? "");
}

async function fillIdentity(): Promise<void> {
  await userEvent.type(screen.getByPlaceholderText("coolnews-dev-v2"), "gridsite");
  await userEvent.type(screen.getByPlaceholderText("Cool News"), "Grid Site");
}

describe("WizardPage — G2 template-dependent steps", () => {
  it("Modern (default) shows the 7 Modern steps and mounts Content Brief next", async () => {
    render(<WizardPage />);
    expect(tabNames()).toEqual(MODERN);

    await fillIdentity();
    await userEvent.type(screen.getByPlaceholderText(/Travel and eating/), "Health news");
    await userEvent.click(screen.getByRole("button", { name: /Next/ }));

    expect(screen.getByRole("heading", { name: "Content Brief" })).toBeInTheDocument();
    // Sanity: the mocked AI suggestion IS called on the Modern path, so the
    // Grid assertion below is meaningful.
    await waitFor(() => expect(vi.mocked(suggestTopics)).toHaveBeenCalled());
  });

  it("Grid shows the 6 Grid steps and never mounts the content steps or calls suggestTopics", async () => {
    render(<WizardPage />);
    await fillIdentity();
    await userEvent.click(screen.getByRole("radio", { name: /Grid/i }));
    expect(tabNames()).toEqual(GRID);

    await userEvent.click(screen.getByRole("button", { name: /Next/ }));
    expect(screen.getByRole("heading", { name: "Grid Feed" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Content Brief" })).not.toBeInTheDocument();

    // Configure one pill so Next unlocks.
    const next = screen.getByRole("button", { name: /Next/ });
    expect(next).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Add topic" }));
    await userEvent.type(screen.getByPlaceholderText("e.g. Health"), "Health");
    await userEvent.click(screen.getByRole("checkbox", { name: "Health" }));
    expect(next).toBeEnabled();
    await userEvent.click(next);

    expect(screen.getByRole("heading", { name: /Groups/ })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: /Next/ })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: /Next/ }));

    expect(screen.getByRole("heading", { name: "Theme" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Card look" })).toBeInTheDocument();

    // Going back to Create Site keeps the Grid list; later steps are locked again.
    await userEvent.click(screen.getByRole("button", { name: "Create Site" }));
    expect(tabNames()).toEqual(GRID);
    expect(screen.getByRole("button", { name: "Grid Feed" })).toBeDisabled();

    // Switching back to Modern on step 0 swaps the list; index 0 stays valid.
    await userEvent.click(screen.getByRole("radio", { name: /Modern/i }));
    expect(tabNames()).toEqual(MODERN);
    expect(screen.getByRole("heading", { name: "Create Site" })).toBeInTheDocument();

    // The Grid flow itself never asked the AI for topics.
    expect(vi.mocked(suggestTopics)).not.toHaveBeenCalled();
  });
});
