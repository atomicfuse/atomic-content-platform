import { describe, it, expect } from "vitest";
import { mergeAlertConfig, loadAlertConfig, DEFAULT_ALERT_CONFIG } from "../config.js";

describe("mergeAlertConfig", () => {
  it("returns full defaults when called with undefined", () => {
    expect(mergeAlertConfig(undefined)).toEqual(DEFAULT_ALERT_CONFIG);
  });

  it("returns full defaults when called with empty object", () => {
    expect(mergeAlertConfig({})).toEqual(DEFAULT_ALERT_CONFIG);
  });

  it("overrides failedArticles.limit while keeping enabled default", () => {
    const result = mergeAlertConfig({ failedArticles: { limit: 5 } });
    expect(result.failedArticles.limit).toBe(5);
    expect(result.failedArticles.enabled).toBe(true);
    expect(result.inReview).toEqual(DEFAULT_ALERT_CONFIG.inReview);
    expect(result.syncFailed).toEqual(DEFAULT_ALERT_CONFIG.syncFailed);
    expect(result.reminders).toEqual(DEFAULT_ALERT_CONFIG.reminders);
  });

  it("overrides imageGenFailed.enabled to true", () => {
    const result = mergeAlertConfig({ imageGenFailed: { enabled: true } });
    expect(result.imageGenFailed.enabled).toBe(true);
    // Other top-level keys untouched
    expect(result.enabled).toBe(true);
    expect(result.failedArticles).toEqual(DEFAULT_ALERT_CONFIG.failedArticles);
  });

  it("ignores bad (non-number) inReview.limit, keeps default", () => {
    const result = mergeAlertConfig({ inReview: { limit: "bad" } });
    expect(result.inReview.limit).toBe(15);
    expect(result.inReview.enabled).toBe(true);
  });

  it("deep-merges reminders keeping unset keys as defaults", () => {
    const result = mergeAlertConfig({ reminders: { reviewBacklog: { weekday: 3 } } });
    expect(result.reminders.reviewBacklog.weekday).toBe(3);
    expect(result.reminders.reviewBacklog.enabled).toBe(true);
    expect(result.reminders.createNewSite).toEqual(DEFAULT_ALERT_CONFIG.reminders.createNewSite);
  });

  it("ignores a bad top-level enabled value (non-boolean), keeps default", () => {
    const result = mergeAlertConfig({ enabled: "yes" });
    expect(result.enabled).toBe(true);
  });

  it("respects top-level enabled: false", () => {
    const result = mergeAlertConfig({ enabled: false });
    expect(result.enabled).toBe(false);
  });
});

describe("loadAlertConfig", () => {
  it("returns defaults when the reader throws (e.g. 404)", async () => {
    const throwingReader = async (): Promise<string> => {
      throw new Error("Not Found");
    };
    const result = await loadAlertConfig(throwingReader);
    expect(result).toEqual(DEFAULT_ALERT_CONFIG);
  });

  it("returns defaults when the reader returns invalid YAML", async () => {
    const badReader = async (): Promise<string> => ":::not yaml:::";
    const result = await loadAlertConfig(badReader);
    expect(result).toEqual(DEFAULT_ALERT_CONFIG);
  });

  it("deep-merges a partial YAML payload from the reader", async () => {
    const partialReader = async (): Promise<string> =>
      "failedArticles:\n  limit: 7\n";
    const result = await loadAlertConfig(partialReader);
    expect(result.failedArticles.limit).toBe(7);
    expect(result.failedArticles.enabled).toBe(true);
    expect(result.enabled).toBe(true);
  });
});
