import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SummaryEditor } from "../SummaryEditor";

afterEach(cleanup);

beforeEach(() => {
  global.fetch = vi.fn(async (url: RequestInfo | URL) => {
    if (String(url).startsWith("/api/grid/summary?")) {
      return new Response(
        JSON.stringify({ exists: true, markdown: "## H\n\nBody", edited: true, sourceChanged: true }),
      );
    }
    return new Response(JSON.stringify({ ok: true }));
  }) as typeof fetch;
});

describe("SummaryEditor", () => {
  it("regenerating a hand-edited summary asks first; cancelling sends nothing", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<SummaryEditor site="a" slug="s" title="T" status="stale" onClose={vi.fn()} onSaved={vi.fn()} />);
    await screen.findByDisplayValue(/Body/);
    await userEvent.click(screen.getByRole("button", { name: "Regenerate" }));
    expect(window.confirm).toHaveBeenCalled();
    expect((global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.some(([u]) => String(u) === "/api/grid/regenerate")).toBe(
      false,
    );
  });

  it("saving PUTs the edited markdown", async () => {
    const onSaved = vi.fn();
    render(<SummaryEditor site="a" slug="s" title="T" status="edited" onClose={vi.fn()} onSaved={onSaved} />);
    const box = await screen.findByDisplayValue(/Body/);
    await userEvent.type(box, " more");
    await userEvent.click(screen.getByRole("button", { name: "Save summary" }));
    const put = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === "PUT",
    );
    expect(JSON.parse(String((put?.[1] as RequestInit).body))).toMatchObject({
      site: "a",
      slug: "s",
      markdown: expect.stringContaining("more"),
    });
    expect(onSaved).toHaveBeenCalled();
  });

  it("has an accessible dialog label and textarea name", async () => {
    render(<SummaryEditor site="a" slug="s" title="Best Telescopes 2026" status="generated" onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(await screen.findByRole("dialog", { name: "Summary for Best Telescopes 2026" })).toBeInTheDocument();
    expect(screen.getByLabelText("Summary markdown")).toBeInTheDocument();
  });
});
