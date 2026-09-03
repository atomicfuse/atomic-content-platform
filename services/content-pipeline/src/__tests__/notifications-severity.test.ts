import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  notifyError,
  notifySummary,
  notifyImageDefaultFallback,
  notifyReviewNeeded,
} from "../lib/notifications.js";

const SLACK = "https://hooks.slack.com/services/T/B/X";
const cfg = { slackWebhookUrl: SLACK };

/** Capture the `text` field POSTed to the Slack webhook. */
function lastSlackText(fetchMock: ReturnType<typeof vi.fn>): string {
  const call = fetchMock.mock.calls.find((c) => c[0] === SLACK);
  if (!call) throw new Error("Slack webhook was not called");
  return JSON.parse((call[1] as { body: string }).body).text as string;
}

describe("notification severity prefixes", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("notifyImageDefaultFallback is NOT CRITICAL", async () => {
    await notifyImageDefaultFallback(cfg, {
      site: "gadgetskoala",
      articleTitle: "X",
      slug: "x",
      reason: "boom",
    });
    const text = lastSlackText(fetchMock);
    expect(text.startsWith("🟡 NOT CRITICAL — ")).toBe(true);
    expect(text).toContain("Image generation failed for site: gadgetskoala");
  });

  it("notifySummary is NOT CRITICAL", async () => {
    await notifySummary(cfg, {
      runId: "r1",
      triggered: 3,
      errors: [{ domain: "womendivision", error: "fast forward" }],
      zeroArticleSites: ["giantsavings"],
    });
    expect(lastSlackText(fetchMock).startsWith("🟡 NOT CRITICAL — ")).toBe(true);
  });

  it("notifyReviewNeeded is NOT CRITICAL", async () => {
    await notifyReviewNeeded(cfg, { site: "s", title: "t" });
    expect(lastSlackText(fetchMock).startsWith("🟡 NOT CRITICAL — ")).toBe(true);
  });

  it("notifyError defaults to NOT CRITICAL", async () => {
    await notifyError(cfg, { agent: "content-generation", error: "boom", site: "womendivision" });
    const text = lastSlackText(fetchMock);
    expect(text.startsWith("🟡 NOT CRITICAL — ")).toBe(true);
    expect(text).toContain("Pipeline error in content-generation (womendivision)");
  });

  it("notifyError can be flagged CRITICAL", async () => {
    await notifyError(cfg, { agent: "sync", error: "site down", critical: true });
    expect(lastSlackText(fetchMock).startsWith("🔴 CRITICAL — ")).toBe(true);
  });

  it("no webhook configured → no fetch", async () => {
    await notifyError({}, { agent: "x", error: "y" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
