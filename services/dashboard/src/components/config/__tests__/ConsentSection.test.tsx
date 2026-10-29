import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { ConsentSection } from "../ConsentSection";
import { UnifiedConfigForm } from "../UnifiedConfigForm";

vi.mock("../grid/GridSettingsSection", () => ({
  GridSettingsSection: (): React.ReactElement => <div>grid-section</div>,
}));

afterEach(cleanup);

describe("ConsentSection", () => {
  it.each(["org", "group", "override", "site"] as const)("renders in %s mode inside UnifiedConfigForm", (mode) => {
    render(<UnifiedConfigForm config={{}} onChange={vi.fn()} mode={mode} />);
    expect(screen.getByRole("heading", { name: "Cookie consent" })).toBeInTheDocument();
  });

  it("org mode: ticking Enabled sets enabled: true", () => {
    const onChange = vi.fn();
    render(<ConsentSection value={{}} onChange={onChange} mode="org" />);
    fireEvent.click(screen.getByRole("checkbox", { name: /show the cookie banner/i }));
    expect(onChange).toHaveBeenCalledWith({ enabled: true });
  });

  it("site mode: Inherit removes enabled, Off sets false", () => {
    const onChange = vi.fn();
    render(<ConsentSection value={{ enabled: true, message: "x" }} onChange={onChange} mode="site" />);
    const select = screen.getByLabelText("Banner");
    fireEvent.change(select, { target: { value: "inherit" } });
    expect(onChange).toHaveBeenLastCalledWith({ message: "x" });
    fireEvent.change(select, { target: { value: "off" } });
    expect(onChange).toHaveBeenLastCalledWith({ enabled: false, message: "x" });
  });

  it("only-these-countries: parses the list on blur and warns about missing EU/UK countries", () => {
    const onChange = vi.fn();
    const { rerender } = render(<ConsentSection value={{ show_to: "countries" }} onChange={onChange} mode="org" />);
    const input = screen.getByLabelText("Countries");
    fireEvent.change(input, { target: { value: "fr, de" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenLastCalledWith({ show_to: "countries", countries: ["FR", "DE"] });
    rerender(<ConsentSection value={{ show_to: "countries", countries: ["FR", "DE"] }} onChange={onChange} mode="org" />);
    expect(screen.getByText(/won't see the banner/i)).toBeInTheDocument();
  });

  it("clearing the message removes the key", () => {
    const onChange = vi.fn();
    render(<ConsentSection value={{ enabled: true, message: "Hi" }} onChange={onChange} mode="org" />);
    fireEvent.change(screen.getByLabelText("Banner message"), { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith({ enabled: true });
  });
});
