import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { NewAuthorModal } from "../NewAuthorModal";

afterEach(() => { cleanup(); push.mockClear(); });

describe("NewAuthorModal", () => {
  it("Generate with AI carries the chosen site and beat to the new profile", async () => {
    render(<NewAuthorModal open onClose={vi.fn()} sites={[{ domain: "scoopella" }, { domain: "popstorylab" }]} />);
    await userEvent.selectOptions(screen.getByLabelText("For site (optional)"), "scoopella");
    await userEvent.type(screen.getByLabelText("Beat (optional)"), "Royals");
    await userEvent.click(screen.getByRole("button", { name: "Generate with AI" }));
    expect(push).toHaveBeenCalledWith("/authors/new?generate=1&site=scoopella&beat=Royals");
  });
  it("Start blank opens an empty profile", async () => {
    render(<NewAuthorModal open onClose={vi.fn()} sites={[]} />);
    await userEvent.click(screen.getByRole("button", { name: "Start blank" }));
    expect(push).toHaveBeenCalledWith("/authors/new");
  });
});
