import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SimilarwebCell } from "../SimilarwebCell";

afterEach(cleanup);
const status = { site: "s", domain: "s.com", has_rank: true, global_rank: 79692, monthly_visits: 1340000, checked_at: "2026-10-11T08:00:00.000Z", source: "manual" as const };

describe("SimilarwebCell", () => {
  it("ranked: check mark + rank text (state in text, not colour only)", () => {
    render(<SimilarwebCell site={{ custom_domain: "s.com" }} status={status} loaded />);
    expect(screen.getByText("#79,692 · 1.34M/mo")).toBeTruthy();
    expect(screen.getByLabelText("Has Similarweb rank")).toBeTruthy();
  });
  it("no rank / no domain / loading", () => {
    const { rerender } = render(<SimilarwebCell site={{ custom_domain: "s.com" }} status={{ ...status, has_rank: false, global_rank: null, monthly_visits: null }} loaded />);
    expect(screen.getByText("No rank")).toBeTruthy();
    rerender(<SimilarwebCell site={{ custom_domain: null }} status={undefined} loaded />);
    expect(screen.getByText("No domain")).toBeTruthy();
    rerender(<SimilarwebCell site={{ custom_domain: "s.com" }} status={undefined} loaded={false} />);
    expect(screen.getByLabelText("Loading Similarweb data")).toBeTruthy();
  });
});
