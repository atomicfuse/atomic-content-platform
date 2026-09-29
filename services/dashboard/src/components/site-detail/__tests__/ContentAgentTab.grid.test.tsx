import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("@/hooks/useReferenceData", () => ({
  useAudiences: () => ({ audiences: [], loading: false }),
  useVerticals: () => ({ verticals: [], loading: false }),
  useCategories: () => ({ categories: [], loading: false }),
  useAllCategories: () => ({ categories: [], loading: false }),
  useTags: () => ({ tags: [], loading: false, refetch: vi.fn() }),
  useTagSearch: () => ({ results: [], loading: false }),
}));

vi.mock("@/actions/wizard", () => ({
  generateLogoPreview: vi.fn(),
  attachCustomDomain: vi.fn(),
  detachCustomDomain: vi.fn(),
  getAvailableZones: vi.fn().mockResolvedValue([]),
}));

import { ContentAgentTab } from "../ContentAgentTab";

afterEach(cleanup);

const baseBrief = {
  audience: "",
  tone: "",
  topics: [],
  preferred_days: [],
  content_guidelines: "",
};

function renderTab(siteConfig: Record<string, unknown> | null): void {
  render(
    <ContentAgentTab
      domain="example.com"
      brief={baseBrief}
      siteConfig={siteConfig}
      stagingBranch="staging/example.com"
      pagesProject={null}
      pagesSubdomain={null}
      customDomain="example.com"
      currentLogoPath={null}
      currentFaviconPath={null}
      previewUrl={null}
    />,
  );
}

describe("ContentAgentTab — Grid vs Modern site-settings menus", () => {
  it("Grid site: hides Content Brief tab and Default Author/Target Audiences/Tone fields", () => {
    renderTab({ theme: { template: "grid" } });

    // Identity is the default tab — its fields render immediately.
    expect(screen.queryByLabelText("Default Author")).not.toBeInTheDocument();
    expect(screen.queryByText("Target Audiences")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Tone")).not.toBeInTheDocument();

    // Tab bar shows no "Content Brief" tab.
    expect(screen.queryByRole("button", { name: "Content Brief" })).not.toBeInTheDocument();

    // Slug/name/tagline/category and Save stay — Grid sites still need these.
    expect(screen.getByLabelText("Site Slug")).toBeInTheDocument();
    expect(screen.getByLabelText("Site Name")).toBeInTheDocument();
    expect(screen.getByLabelText("Tagline")).toBeInTheDocument();
    expect(screen.getByLabelText("Category (optional)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save Identity" })).toBeInTheDocument();
  });

  it("Modern site: keeps Content Brief tab and Default Author/Target Audiences/Tone fields (unchanged)", () => {
    renderTab({ theme: { base: "classic" } });

    expect(screen.getByLabelText("Default Author")).toBeInTheDocument();
    expect(screen.getByText("Target Audiences")).toBeInTheDocument();
    expect(screen.getByLabelText("Tone")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Content Brief" })).toBeInTheDocument();
  });

  it("Modern site (no siteConfig at all): keeps Content Brief tab and content-agent fields", () => {
    renderTab(null);

    expect(screen.getByLabelText("Default Author")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Content Brief" })).toBeInTheDocument();
  });
});
