import { describe, it, expect, beforeEach } from "vitest";
import { resetApiStats, totalApiCalls, recordApiCall, recordCacheHit, formatApiStats } from "../lib/github-stats.js";

beforeEach(() => {
  resetApiStats();
});

describe("github-stats counter", () => {
  it("tracks API calls and cache hits", () => {
    recordApiCall("getRef");
    recordApiCall("getTree");
    recordApiCall("getBlob");
    recordApiCall("getBlob");
    recordCacheHit("tree");
    recordCacheHit("blob");

    const stats = resetApiStats();
    expect(totalApiCalls(stats)).toBe(4);
    expect(stats.getRef).toBe(1);
    expect(stats.getTree).toBe(1);
    expect(stats.getBlob).toBe(2);
    expect(stats.treeCacheHits).toBe(1);
    expect(stats.blobCacheHits).toBe(1);
  });

  it("resetApiStats returns snapshot and clears", () => {
    recordApiCall("getRef");
    const snapshot = resetApiStats();
    expect(snapshot.getRef).toBe(1);

    const afterReset = resetApiStats();
    expect(totalApiCalls(afterReset)).toBe(0);
  });

  it("formatApiStats produces readable output", () => {
    recordApiCall("getRef");
    recordApiCall("getTree");
    const stats = resetApiStats();
    const formatted = formatApiStats(stats);
    expect(formatted).toContain("[github-stats] 2 API calls");
    expect(formatted).toContain("ref:1");
    expect(formatted).toContain("tree:1");
  });
});
