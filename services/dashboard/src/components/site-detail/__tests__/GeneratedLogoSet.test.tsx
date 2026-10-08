import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { GeneratedLogoSet } from "../GeneratedLogoSet";

afterEach(cleanup);

const base = { model: "gpt-image-2.5-sunburst", headerBg: "#7c1d2f", footerBg: "#ffffff" };

describe("GeneratedLogoSet", () => {
  it("while the logo is being made: step 1 status, three placeholders", () => {
    render(<GeneratedLogoSet {...base} step="logo" logo={null} footerLogo={null} favicon={null} footerExpected />);
    expect(screen.getByRole("status").textContent).toMatch(/Step 1 of 2 · Creating the logo/);
    expect(screen.getAllByText("Making…")).toHaveLength(3);
  });

  it("after the logo: shows it with a preview, footer and favicon still in progress", () => {
    render(<GeneratedLogoSet {...base} step="extras" logo="AAA" footerLogo={null} favicon={null} footerExpected />);
    expect(screen.getByRole("status").textContent).toMatch(/Step 2 of 2 · Making the favicon and footer logo/);
    expect(screen.getByRole("button", { name: "Enlarge Header logo" })).toBeTruthy();
    expect(screen.getAllByText("Making…")).toHaveLength(2);
  });

  it("when done: every made asset has a preview; a footer that isn't needed says so", () => {
    render(<GeneratedLogoSet {...base} step="done" logo="AAA" footerLogo={null} favicon="FFF" footerExpected={false} />);
    expect(screen.getByRole("status").textContent).toMatch(/Done.*save to apply/i);
    expect(screen.getByRole("button", { name: "Enlarge Favicon" })).toBeTruthy();
    expect(screen.getByText(/Not needed/)).toBeTruthy();
    expect(screen.getByText(/gpt-image-2.5-sunburst/)).toBeTruthy();
  });

  it("a slot that failed says so instead of spinning forever", () => {
    render(<GeneratedLogoSet {...base} step="done" logo="AAA" footerLogo={null} favicon={null} footerExpected />);
    expect(screen.getAllByText(/Not made/)).toHaveLength(2);
  });
});
