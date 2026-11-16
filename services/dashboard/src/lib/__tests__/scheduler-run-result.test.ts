import { describe, it, expect } from "vitest";
import { summarizeRunNow } from "../scheduler-run-result";

describe("summarizeRunNow", () => {
  it("explains that a queued run happens in the background", () => {
    const out = summarizeRunNow({ status: "ok", queued: true, runId: "2026-11-16T07", triggered: [] });
    expect(out.tone).toBe("success");
    expect(out.message).toContain("2026-11-16T07");
    expect(out.message).toMatch(/queued/i);
  });

  it("tells the user when this hour's run is already queued", () => {
    const out = summarizeRunNow({ status: "ok", alreadyQueued: true, runId: "2026-11-16T07" });
    expect(out.tone).toBe("info");
    expect(out.message).toMatch(/already/i);
  });

  it("keeps the legacy synchronous wording (local dev without a queue)", () => {
    const out = summarizeRunNow({ status: "ok", triggered: ["a", "b"] });
    expect(out).toEqual({ tone: "success", message: "Triggered 2 site(s)" });
  });

  it("surfaces an error response", () => {
    const out = summarizeRunNow({ error: "Failed to trigger scheduler" });
    expect(out).toEqual({ tone: "error", message: "Failed to trigger scheduler" });
  });
});
