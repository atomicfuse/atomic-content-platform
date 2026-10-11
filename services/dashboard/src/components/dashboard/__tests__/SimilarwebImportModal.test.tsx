import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const toast = vi.fn();
vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ toast }) }));

import { SimilarwebImportModal } from "../SimilarwebImportModal";

afterEach(() => { cleanup(); vi.restoreAllMocks(); toast.mockClear(); });
const SITES = [{ domain: "journeypeaks", custom_domain: "journeypeaks.com" }, { domain: "scoopella", custom_domain: "scoopella.com" }];
const CSV = "domain,site,similarweb,global_rank,monthly_visits\njourneypeaks.com,journeypeaks,yes,79692,1.34M\nscoopella.com,scoopella,no,,\nx.com,x,no,,";

describe("SimilarwebImportModal", () => {
  it("previews counts, then imports and reports", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ updated: 2, ignored: 0, rejected: [], unknown: ["x.com"] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const onImported = vi.fn();
    render(<SimilarwebImportModal open onClose={vi.fn()} sites={SITES} onImported={onImported} />);
    fireEvent.change(screen.getByLabelText("Checklist results"), { target: { value: CSV } });
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(screen.getByText("3 rows · 1 has rank · 1 no rank · 1 not matched · 0 rejected")).toBeTruthy();
    expect(screen.getByText("x.com")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Import 2 sites" }));
    await waitFor(() => expect(onImported).toHaveBeenCalled());
    expect(toast).toHaveBeenCalledWith("Similarweb updated for 2 sites", "success");
    expect(JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string).csv).toBe(CSV);
  });

  it("explains a file that isn't the checklist results and keeps Import disabled", () => {
    render(<SimilarwebImportModal open onClose={vi.fn()} sites={SITES} onImported={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Checklist results"), { target: { value: "url,rank\na.com,1" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(screen.getByText(/missing column: similarweb, domain or site/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Import/ })).toBeNull();
  });
});
