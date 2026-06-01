import { describe, it, expect } from "vitest";
import { shouldAutoPublish } from "../queue/scheduler-flow.js";
import type { SiteRunResult } from "../agents/scheduled-publisher/history.js";

describe("shouldAutoPublish", () => {
  it("returns true for live site with successful articles", () => {
    const result: SiteRunResult = {
      domain: "popnsnap",
      status: "success",
      articlesCreated: 3,
      articlesRequested: 3,
    };
    expect(shouldAutoPublish(result, "live")).toBe(true);
  });

  it("returns true for live site with partial success", () => {
    const result: SiteRunResult = {
      domain: "popnsnap",
      status: "partial",
      articlesCreated: 1,
      articlesRequested: 3,
    };
    expect(shouldAutoPublish(result, "live")).toBe(true);
  });

  it("returns false for non-live site", () => {
    const result: SiteRunResult = {
      domain: "chaibeseret",
      status: "success",
      articlesCreated: 2,
      articlesRequested: 2,
    };
    expect(shouldAutoPublish(result, "staging")).toBe(false);
  });

  it("returns false for live site with zero articles created", () => {
    const result: SiteRunResult = {
      domain: "popnsnap",
      status: "no_content",
      articlesCreated: 0,
      articlesRequested: 3,
    };
    expect(shouldAutoPublish(result, "live")).toBe(false);
  });

  it("returns false for errored site", () => {
    const result: SiteRunResult = {
      domain: "popnsnap",
      status: "error",
      articlesCreated: 0,
      articlesRequested: 3,
    };
    expect(shouldAutoPublish(result, "live")).toBe(false);
  });

  it("returns true for ready site (treated as live)", () => {
    const result: SiteRunResult = {
      domain: "popnsnap",
      status: "success",
      articlesCreated: 2,
      articlesRequested: 2,
    };
    expect(shouldAutoPublish(result, "ready")).toBe(false);
  });
});
