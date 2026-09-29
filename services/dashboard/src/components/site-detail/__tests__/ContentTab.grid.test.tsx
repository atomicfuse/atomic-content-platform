import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ContentTab } from "../ContentTab";
import type { ArticleEntry } from "@/types/dashboard";

afterEach(cleanup);

const articles: ArticleEntry[] = [
  { slug: "a", title: "Article A", type: "standard", status: "published", publishDate: "2026-01-01" },
];

describe("ContentTab — Grid notice", () => {
  it("Grid site: shows the Grid notice instead of the articles table", () => {
    render(<ContentTab articles={articles} domain="grid.example" stagingBranch="staging/grid.example" isGrid />);

    expect(screen.getByText("This is a Grid site")).toBeInTheDocument();
    expect(
      screen.getByText(/it has no articles of its own/i),
    ).toBeInTheDocument();
    expect(screen.queryByText("Article A")).not.toBeInTheDocument();
    expect(screen.queryByText(/Articles \(/)).not.toBeInTheDocument();
  });

  it("Modern site: renders the articles table unchanged (isGrid omitted)", () => {
    render(<ContentTab articles={articles} domain="modern.example" stagingBranch="staging/modern.example" />);

    expect(screen.getByText("Articles (1)")).toBeInTheDocument();
    expect(screen.getByText("Article A")).toBeInTheDocument();
    expect(screen.queryByText("This is a Grid site")).not.toBeInTheDocument();
  });
});
