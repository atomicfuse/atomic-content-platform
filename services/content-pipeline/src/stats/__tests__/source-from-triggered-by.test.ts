import { describe, it, expect } from "vitest";
import { sourceFromTriggeredBy } from "../recorder.js";

describe("sourceFromTriggeredBy", () => {
  it("maps 'manual' to 'dashboard'", () => {
    expect(sourceFromTriggeredBy("manual")).toBe("dashboard");
  });

  it("maps 'scheduled' to 'scheduler'", () => {
    expect(sourceFromTriggeredBy("scheduled")).toBe("scheduler");
  });

  it("maps 'scheduled-forced' to 'scheduler'", () => {
    expect(sourceFromTriggeredBy("scheduled-forced")).toBe("scheduler");
  });

  it("maps 'wp-import' to 'wp-import'", () => {
    expect(sourceFromTriggeredBy("wp-import")).toBe("wp-import");
  });
});
