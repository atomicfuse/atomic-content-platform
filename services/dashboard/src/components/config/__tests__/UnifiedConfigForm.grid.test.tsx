import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { UnifiedConfigForm } from "../UnifiedConfigForm";

vi.mock("../grid/GridSettingsSection", () => ({
  GridSettingsSection: (): React.ReactElement => <div>grid-section</div>,
}));

afterEach(cleanup);

describe("UnifiedConfigForm grid section", () => {
  it("shows the Grid template section in group mode", async () => {
    render(<UnifiedConfigForm config={{}} onChange={vi.fn()} mode="group" />);
    expect(await screen.findByText("Grid template")).toBeInTheDocument();
    expect(await screen.findByText("grid-section")).toBeInTheDocument();
  });

  it("hides the Grid template section in site mode", () => {
    render(<UnifiedConfigForm config={{}} onChange={vi.fn()} mode="site" />);
    expect(screen.queryByText("Grid template")).not.toBeInTheDocument();
  });
});
