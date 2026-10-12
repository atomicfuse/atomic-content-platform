import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn() }) }));

import { UnsavedChangesGuard } from "../UnsavedChangesGuard";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("UnsavedChangesGuard", () => {
  it("closing the tab sets returnValue too (Safari / older Chromium only prompt on it)", () => {
    render(<UnsavedChangesGuard when />);
    // jsdom has no BeforeUnloadEvent; its plain Event treats returnValue as a boolean, so give it a real one.
    const e = new Event("beforeunload", { cancelable: true }) as BeforeUnloadEvent;
    Object.defineProperty(e, "returnValue", { value: undefined, writable: true });
    window.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(e.returnValue).toBeTruthy();
  });

  it("browser Back while dirty asks first; Stay keeps the page, Leave goes back past the guard entry", async () => {
    const pushState = vi.spyOn(window.history, "pushState");
    const go = vi.spyOn(window.history, "go").mockImplementation(() => undefined);
    render(<UnsavedChangesGuard when />);
    expect(pushState).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(await screen.findByRole("dialog", { name: "Leave without saving?" })).toBeTruthy();
    expect(pushState).toHaveBeenCalledTimes(2);
    await userEvent.click(screen.getByRole("button", { name: "Stay" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    window.dispatchEvent(new PopStateEvent("popstate"));
    await userEvent.click(await screen.findByRole("button", { name: "Leave" }));
    expect(go).toHaveBeenCalledWith(-2);
    expect(push).not.toHaveBeenCalled();
  });

  it("after saving, one Back press still leaves (the guard entry is skipped)", () => {
    const back = vi.spyOn(window.history, "back").mockImplementation(() => undefined);
    const { rerender } = render(<UnsavedChangesGuard when />);
    rerender(<UnsavedChangesGuard when={false} />);
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(back).toHaveBeenCalledTimes(1);
  });
});
