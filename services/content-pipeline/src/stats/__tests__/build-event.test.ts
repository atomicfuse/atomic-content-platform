import { describe, it, expect } from "vitest";
import { buildGenerationEvent } from "../recorder.js";
import type { BatchContentGenerationResult } from "../../agents/content-generation/agent.js";

const now = new Date("2026-06-07T14:02:00Z");
const started = new Date("2026-06-07T14:00:00Z");

function batch(
  results: Array<{ status: "created" | "skipped" | "error" }>,
  totalSourced = 10,
): BatchContentGenerationResult {
  return {
    siteDomain: "travelswire",
    requested: results.length,
    totalSourced,
    duplicateCount: 0,
    availableNew: 0,
    n8nImagesTriggered: 0,
    results: results as BatchContentGenerationResult["results"],
  };
}

describe("buildGenerationEvent", () => {
  it("success: all created", () => {
    const e = buildGenerationEvent(
      batch([{ status: "created" }, { status: "created" }]),
      { source: "scheduler", forced: false, topicName: null, startedAt: started, finishedAt: now },
    );
    expect(e.created).toBe(2);
    expect(e.failed).toBe(0);
    expect(e.status).toBe("success");
  });

  it("partial: some created, some error", () => {
    const e = buildGenerationEvent(
      batch([{ status: "created" }, { status: "error" }]),
      { source: "dashboard", forced: false, topicName: null, startedAt: started, finishedAt: now },
    );
    expect(e.created).toBe(1);
    expect(e.failed).toBe(1);
    expect(e.status).toBe("partial");
  });

  it("error: requested>0, zero created, has errors", () => {
    const e = buildGenerationEvent(
      batch([{ status: "error" }]),
      { source: "scheduler", forced: true, topicName: null, startedAt: started, finishedAt: now },
    );
    expect(e.status).toBe("error");
    expect(e.created).toBe(0);
  });

  it("no_content: nothing created, no errors (all skipped / none sourced)", () => {
    const e = buildGenerationEvent(
      batch([{ status: "skipped" }]),
      { source: "scheduler", forced: false, topicName: null, startedAt: started, finishedAt: now },
    );
    expect(e.status).toBe("no_content");
    expect(e.created).toBe(0);
    expect(e.failed).toBe(0);
  });
});
