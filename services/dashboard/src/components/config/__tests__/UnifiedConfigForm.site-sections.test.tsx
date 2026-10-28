import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { UnifiedConfigForm } from "../UnifiedConfigForm";

vi.mock("../grid/GridSettingsSection", () => ({
  GridSettingsSection: (): React.ReactElement => <div>grid-section</div>,
}));

afterEach(cleanup);

// The site's own Theme tab edits the site theme; the Config tab must not show a
// second Theme editor whose changes are never saved.
describe("UnifiedConfigForm site-mode sections", () => {
  it("shows ads.txt and Legal but not Theme in site mode", () => {
    render(<UnifiedConfigForm config={{}} onChange={vi.fn()} mode="site" />);
    expect(screen.getByRole("heading", { name: "ads.txt" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Legal" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Theme" })).not.toBeInTheDocument();
  });

  it("still shows Theme in group mode", () => {
    render(<UnifiedConfigForm config={{}} onChange={vi.fn()} mode="group" />);
    expect(screen.getByRole("heading", { name: "Theme" })).toBeInTheDocument();
  });
});
