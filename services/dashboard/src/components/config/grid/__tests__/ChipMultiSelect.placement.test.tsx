import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ChipMultiSelect } from "../ChipMultiSelect";

afterEach(cleanup);

const OPTIONS = [{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }];

function renderAt(bottom: number): HTMLElement {
  const { container } = render(<ChipMultiSelect label="Sites" addLabel="+ Add site" value={[]} options={OPTIONS} onChange={(): void => undefined} />);
  const root = container.firstElementChild as HTMLElement;
  root.getBoundingClientRect = (): DOMRect => ({ top: bottom - 40, bottom, left: 0, right: 300, width: 300, height: 40, x: 0, y: bottom - 40, toJSON: () => ({}) }) as DOMRect;
  fireEvent.click(screen.getByRole("button", { name: /Add site/ }));
  return screen.getByRole("listbox").closest("[data-popover]") as HTMLElement;
}

describe("ChipMultiSelect popover placement", () => {
  it("opens below when there is room", () => {
    expect(renderAt(200).dataset.placement).toBe("below");
  });
  it("opens above near the bottom of the screen, so it never runs off-screen", () => {
    expect(renderAt(window.innerHeight - 60).dataset.placement).toBe("above");
  });
});
