/**
 * Image-timeout alerts must be decided by the article, not by one replica's
 * memory (Bug A — 2026-08-27).
 *
 * sites-platform runs 5 replicas. `trackPendingImage` registers a 300s timer in
 * the triggering replica's memory; n8n's callback is load-balanced and usually
 * lands on a different replica, which marks success in ITS OWN `successfulImages`
 * set. The original replica's timer then fired an alert for an article that had
 * an image — proven in production by these two lines, same slug, 4 min apart:
 *
 *   09:01:31  [dogslabs/firefighters-...] SUCCESS — image delivered (21815ms)
 *   09:05:43  TIMEOUT — no callback for dogslabs/firefighters-... after 300s
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockNotifyFallback = vi.fn();

vi.mock("../lib/notifications.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/notifications.js")>();
  return { ...actual, notifyImageDefaultFallback: (...a: unknown[]) => mockNotifyFallback(...a) };
});

const { trackPendingImage, clearPendingImage, shouldAlertOnImageTimeout } = await import(
  "../agents/content-generation/n8n-image.js"
);
// The real implementation, bypassing the module mock above — this test is
// specifically about the message body the real function builds.
const { notifyImageDefaultFallback } = await vi.importActual<
  typeof import("../lib/notifications.js")
>("../lib/notifications.js");

const DOMAIN = "dogslabs";
const SLUG = "firefighters-rescue-lab-mix-dog-mistaken-for-ducklings";
const REAL_IMAGE = `/assets/images/${SLUG}.webp`;
const GENERAL_IMAGE = `/assets/images/${DOMAIN}-general-article.webp`;
const TIMEOUT_MS = 5 * 60 * 1000;

describe("shouldAlertOnImageTimeout", () => {
  it("stays silent when this process already saw the callback succeed", () => {
    expect(shouldAlertOnImageTimeout(true, GENERAL_IMAGE, DOMAIN)).toBe(false);
  });

  it("stays silent when the article has a real per-article image", () => {
    // The production false-positive case: another replica handled the callback.
    expect(shouldAlertOnImageTimeout(false, REAL_IMAGE, DOMAIN)).toBe(false);
  });

  it("alerts when the article still carries the site's general image", () => {
    expect(shouldAlertOnImageTimeout(false, GENERAL_IMAGE, DOMAIN)).toBe(true);
  });

  it("alerts when the article has no image at all", () => {
    expect(shouldAlertOnImageTimeout(false, undefined, DOMAIN)).toBe(true);
  });

  it("alerts when the image could not be verified — silence is worse than noise", () => {
    expect(shouldAlertOnImageTimeout(false, null, DOMAIN)).toBe(true);
  });
});

describe("trackPendingImage — verifies before alerting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does NOT alert when the article turns out to have an image", async () => {
    const verifier = vi.fn(async () => REAL_IMAGE);

    trackPendingImage("img_1", DOMAIN, SLUG, "Firefighters Rescue", {}, verifier);
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS + 1000);

    expect(verifier).toHaveBeenCalledWith(DOMAIN, SLUG);
    expect(mockNotifyFallback).not.toHaveBeenCalled();
  });

  it("DOES alert when the article still uses the general image", async () => {
    const verifier = vi.fn(async () => GENERAL_IMAGE);

    trackPendingImage("img_2", DOMAIN, SLUG, "Firefighters Rescue", {}, verifier);
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS + 1000);

    expect(mockNotifyFallback).toHaveBeenCalledTimes(1);
    const params = mockNotifyFallback.mock.calls[0]?.[1] as { site: string; slug: string; reason: string };
    expect(params.site).toBe(DOMAIN);
    expect(params.slug).toBe(SLUG);
    expect(params.reason).toContain("default image");
  });

  it("alerts and says so when verification itself fails", async () => {
    const verifier = vi.fn(async () => {
      throw new Error("github 503");
    });

    trackPendingImage("img_3", DOMAIN, SLUG, "Firefighters Rescue", {}, verifier);
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS + 1000);

    expect(mockNotifyFallback).toHaveBeenCalledTimes(1);
    const params = mockNotifyFallback.mock.calls[0]?.[1] as { reason: string };
    expect(params.reason).toMatch(/could not verify/i);
  });

  it("never reads or alerts when the callback cleared the request in time", async () => {
    const verifier = vi.fn(async () => GENERAL_IMAGE);

    trackPendingImage("img_4", DOMAIN, SLUG, "Firefighters Rescue", {}, verifier);
    clearPendingImage("img_4");
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS + 1000);

    expect(verifier).not.toHaveBeenCalled();
    expect(mockNotifyFallback).not.toHaveBeenCalled();
  });

  it("still alerts with no verifier injected — the timer is never silently disabled", async () => {
    trackPendingImage("img_5", DOMAIN, SLUG, "Firefighters Rescue", {});
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS + 1000);

    expect(mockNotifyFallback).toHaveBeenCalledTimes(1);
  });
});

describe("notifyImageDefaultFallback — link must not be broken", () => {
  it("links to the dashboard, never to https://<siteId>/articles/<slug>", async () => {
    const sent: string[] = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      sent.push(String((init as { body?: unknown })?.body ?? ""));
      return new Response("ok");
    });

    await notifyImageDefaultFallback(
      { slackWebhookUrl: "https://hooks.slack.test/x" },
      { site: DOMAIN, articleTitle: "Firefighters Rescue", slug: SLUG, reason: "test" },
    );

    expect(sent).toHaveLength(1);
    const body = sent[0] ?? "";
    // The two production bugs: siteId used as a hostname, and a route that 404s.
    expect(body).not.toContain(`https://${DOMAIN}/`);
    expect(body).not.toContain(`/articles/${SLUG}`);
    expect(body).toContain("/articles/general-images");
    fetchSpy.mockRestore();
  });
});
