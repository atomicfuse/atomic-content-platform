import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LogoThumb } from "../LogoThumb";

afterEach(cleanup);

describe("LogoThumb", () => {
  it("is a labelled button whose preview shows the logo larger on the site's header colour", () => {
    render(<LogoThumb src="data:image/png;base64,AAA" alt="Logo preview" background="#c27b4a" backgroundLabel="header" className="w-14 h-14" />);
    const trigger = screen.getByRole("button", { name: "Enlarge Logo preview" });
    fireEvent.click(trigger);
    const preview = screen.getByRole("dialog", { name: "Logo preview, enlarged" });
    const stage = preview.querySelector("[data-stage]") as HTMLElement;
    expect(stage.style.backgroundColor).toBe("rgb(194, 123, 74)");
    expect(stage.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,AAA");
    expect(preview.textContent).toContain("On header #c27b4a");
  });

  it("closes with Escape", () => {
    render(<LogoThumb src="x.png" alt="Current logo" className="w-14 h-14" />);
    fireEvent.click(screen.getByRole("button", { name: "Enlarge Current logo" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
