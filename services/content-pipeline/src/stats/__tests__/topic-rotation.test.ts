import { describe, it, expect } from "vitest";
import { selectTopicsRoundRobin } from "../topic-rotation.js";

describe("selectTopicsRoundRobin", () => {
  const topics = ["Tech", "Travel", "Food", "Sports", "Music"];

  it("picks first N topics when nextIndex is 0", () => {
    const result = selectTopicsRoundRobin(topics, 2, 0);
    expect(result.selected).toEqual(["Tech", "Travel"]);
    expect(result.newNextIndex).toBe(2);
  });

  it("wraps around when nextIndex + count exceeds length", () => {
    const result = selectTopicsRoundRobin(topics, 2, 4);
    expect(result.selected).toEqual(["Music", "Tech"]);
    expect(result.newNextIndex).toBe(1);
  });

  it("handles count >= topics length (full cycle)", () => {
    const result = selectTopicsRoundRobin(topics, 5, 0);
    expect(result.selected).toEqual(["Tech", "Travel", "Food", "Sports", "Music"]);
    expect(result.newNextIndex).toBe(0);
  });

  it("handles count > topics length (wraps multiple times)", () => {
    const result = selectTopicsRoundRobin(topics, 7, 0);
    expect(result.selected).toEqual(["Tech", "Travel", "Food", "Sports", "Music", "Tech", "Travel"]);
    expect(result.newNextIndex).toBe(2);
  });

  it("clamps nextIndex when it exceeds array length (topic removed)", () => {
    const result = selectTopicsRoundRobin(topics, 2, 99);
    // 99 % 5 = 4 → starts at index 4
    expect(result.selected).toEqual(["Music", "Tech"]);
    expect(result.newNextIndex).toBe(1);
  });

  it("returns empty when topics array is empty", () => {
    const result = selectTopicsRoundRobin([], 3, 0);
    expect(result.selected).toEqual([]);
    expect(result.newNextIndex).toBe(0);
  });

  it("returns empty when count is 0", () => {
    const result = selectTopicsRoundRobin(topics, 0, 2);
    expect(result.selected).toEqual([]);
    expect(result.newNextIndex).toBe(2);
  });
});
