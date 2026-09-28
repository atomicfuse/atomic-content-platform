import { describe, expect, it, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { SourcesPreview } from "../SourcesPreview";

afterEach(cleanup);

describe("SourcesPreview", () => {
  it("groups included sites by pill and explains exclusions", () => {
    render(
      <SourcesPreview
        topics={[{ label: "Travel", slug: "travel", verticals: ["Travel"] }]}
        sources={[
          { siteId: "a", included: true, pills: ["travel"] },
          { siteId: "x", included: true, pills: [] },
          { siteId: "hiddenstorydaily", included: false, reason: "no_matching_vertical", pills: [] },
          { siteId: "muvizzcom", included: false, reason: "dev1_account", pills: [] },
        ]}
      />,
    );
    expect(screen.getByText("Travel (1)")).toBeInTheDocument();
    expect(screen.getByText("All only (1)")).toBeInTheDocument();
    expect(screen.getByText(/hiddenstorydaily — no vertical matches a pill/)).toBeInTheDocument();
    expect(screen.getByText(/muvizzcom — legacy account \(unavailable\)/)).toBeInTheDocument();
  });

  it("matches sites to pills using the worker's slugs (& / accents / duplicates)", () => {
    render(
      <SourcesPreview
        topics={[
          { label: "Food & Drink", verticals: [] },
          { label: "Café", verticals: [] },
          { label: "Travel", verticals: [] },
          { label: "Travel", verticals: [] },
        ]}
        sources={[
          { siteId: "eats", included: true, pills: ["food-and-drink"] },
          { siteId: "beans", included: true, pills: ["cafe"] },
          { siteId: "trips", included: true, pills: ["travel-2"] },
        ]}
      />,
    );
    expect(screen.getByText("Food & Drink (1)")).toBeInTheDocument();
    expect(screen.getByText("Café (1)")).toBeInTheDocument();
    expect(screen.getByText("Travel (0)")).toBeInTheDocument();
    expect(screen.getByText("Travel (1)")).toBeInTheDocument();
  });
});
