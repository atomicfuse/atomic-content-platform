import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AuthorAvatar } from "../AuthorAvatar";

afterEach(cleanup);

const PORTRAIT = { kind: "generated" as const, path: "/authors/assets/ngozi-adeyemi-0123456789.webp" };

describe("AuthorAvatar preview", () => {
  it("button preview (profile editor): enlarges on click, shows the portrait large with the name, closes with Escape", () => {
    render(<AuthorAvatar name="Ngozi Adeyemi" portrait={PORTRAIT} size="lg" preview="button" />);
    fireEvent.click(screen.getByRole("button", { name: "Enlarge portrait of Ngozi Adeyemi" }));
    const dialog = screen.getByRole("dialog", { name: "Portrait of Ngozi Adeyemi, enlarged" });
    expect(dialog.querySelector("img")?.getAttribute("src")).toBe("/api/authors/portrait?path=%2Fauthors%2Fassets%2Fngozi-adeyemi-0123456789.webp");
    expect(dialog.textContent).toContain("Ngozi Adeyemi");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("hover preview (inside a card link): no nested button; opens on mouse hover and closes on leave", async () => {
    const { container } = render(<a href="/authors/ngozi-adeyemi"><AuthorAvatar name="Ngozi Adeyemi" portrait={PORTRAIT} preview="hover" /></a>);
    expect(screen.queryByRole("button")).toBeNull();
    const trigger = container.querySelector("[data-preview-trigger]") as HTMLElement;
    fireEvent.mouseEnter(trigger);
    expect(screen.getByRole("dialog", { name: "Portrait of Ngozi Adeyemi, enlarged" })).toBeTruthy();
    fireEvent.mouseLeave(trigger);
    await act(async () => { await new Promise((r) => setTimeout(r, 200)); });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("initials (no portrait) never preview", () => {
    render(<AuthorAvatar name="Ngozi Adeyemi" portrait={null} preview="button" />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("NA")).toBeTruthy();
  });
});
