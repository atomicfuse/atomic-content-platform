import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { TopicV2 } from "@/types/dashboard";

// Mutable hook state, controlled per test.
let catState: { categories: Array<{ id: string; name: string; parent_id: string | null }>; loading: boolean };
let tagState: { tags: Array<{ id: string; name: string }>; loading: boolean };

vi.mock("@/hooks/useReferenceData", () => ({
  useAllCategories: () => catState,
  useTags: () => tagState,
  useTagSearch: () => ({ results: [], loading: false }),
  useBundles: () => ({ bundles: [], loading: false }),
}));

vi.mock("@/lib/reference-data", () => ({
  resolveCategoryNames: vi.fn(async () => ({})),
  resolveTagNames: vi.fn(async () => ({})),
}));

import { TopicEditModal } from "../TopicEditModal";

beforeEach(() => {
  catState = { categories: [], loading: false };
  tagState = { tags: [], loading: false };
});
afterEach(cleanup);

const noop = (): void => {};

describe("TopicEditModal — name resolution", () => {
  it("renders persisted names instead of raw ids when the taxonomy lists are empty", () => {
    const topic: TopicV2 = {
      name: "Animals",
      source: {
        type: "filter",
        category_ids: ["6a00793d1104bbff809b7c59"],
        tag_ids: ["6a044ccf86fcaaeb5bc8387c"],
        category_names: { "6a00793d1104bbff809b7c59": "Pets" },
        tag_names: { "6a044ccf86fcaaeb5bc8387c": "dog videos" },
      },
    };
    render(<TopicEditModal initial={topic} siteTheme="funny" existingNames={["Animals"]} onClose={noop} onSave={noop} />);

    expect(screen.getByText("Pets")).toBeInTheDocument();
    expect(screen.getByText("dog videos")).toBeInTheDocument();
    // The raw id must NOT be shown.
    expect(screen.queryByText("6a00793d1104bbff809b7c59")).not.toBeInTheDocument();
  });
});

describe("TopicEditModal — re-propose guard", () => {
  it("disables Re-propose while the taxonomy is loading", () => {
    catState = { categories: [], loading: true };
    tagState = { tags: [], loading: true };
    const topic: TopicV2 = {
      name: "Animals",
      source: { type: "filter", category_ids: ["c1"], tag_ids: [], category_names: { c1: "Pets" } },
    };
    render(<TopicEditModal initial={topic} siteTheme="funny" existingNames={["Animals"]} onClose={noop} onSave={noop} />);
    const btn = screen.getByRole("button", { name: /Loading taxonomy/i });
    expect(btn).toBeDisabled();
  });

  it("enables Re-propose once categories are loaded", () => {
    catState = { categories: [{ id: "c1", name: "Pets", parent_id: null }], loading: false };
    const topic: TopicV2 = {
      name: "Animals",
      source: { type: "filter", category_ids: ["c1"], tag_ids: [] },
    };
    render(<TopicEditModal initial={topic} siteTheme="funny" existingNames={["Animals"]} onClose={noop} onSave={noop} />);
    expect(screen.getByRole("button", { name: /Re-propose with AI/i })).toBeEnabled();
  });

  it("shows a failure banner and disables Propose when the taxonomy can't load", () => {
    catState = { categories: [], loading: false }; // not loading, but empty => failed
    render(<TopicEditModal siteTheme="funny" existingNames={[]} onClose={noop} onSave={noop} />);
    expect(screen.getByText(/Couldn't load the content taxonomy/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Propose filter with AI/i })).toBeDisabled();
  });
});
