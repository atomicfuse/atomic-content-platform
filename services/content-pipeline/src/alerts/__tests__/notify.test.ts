import { describe, it, expect, vi, afterEach } from "vitest";
import { notifyAttention, notifyImageDefaultFallback } from "../../lib/notifications.js";

afterEach(() => vi.unstubAllGlobals());

describe("notifyAttention", () => {
  it("posts the message verbatim and returns true", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response);
    vi.stubGlobal("fetch", fetchMock);
    const ok = await notifyAttention({ slackWebhookUrl: "https://hooks.slack.com/x" } as any, "⚠ travelswire: 5 failed articles in 7d (limit 3)");
    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    if (!call) throw new Error("fetch was not called");
    const body = JSON.parse((call[1] as any).body as string);
    expect(body.text).toBe("⚠ travelswire: 5 failed articles in 7d (limit 3)"); // verbatim, no prefix
  });
  it("returns false (no throw) when no webhook configured", async () => {
    expect(await notifyAttention({} as any, "x")).toBe(false);
  });
  it("returns false when the send fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("boom")));
    expect(await notifyAttention({ slackWebhookUrl: "https://hooks.slack.com/x" } as any, "x")).toBe(false);
  });

  // A revoked webhook, a deleted channel, or a removed app answers with a 4xx
  // *body* — fetch RESOLVES, it does not throw. Before 2026-08-31 sendSlack
  // ignored the response entirely, so notifyAttention returned true, the alert
  // was recorded as delivered and lastFiredAt advanced. Nothing arrived, and
  // nothing ever retried.
  it("returns false when Slack answers 403 — a resolved non-2xx is still a failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false, status: 403, statusText: "Forbidden", text: async () => "invalid_token",
    } as unknown as Response));
    expect(
      await notifyAttention({ slackWebhookUrl: "https://hooks.slack.com/x" } as any, "x"),
    ).toBe(false);
  });

  it("returns false when Slack answers 404 (revoked webhook)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false, status: 404, statusText: "Not Found", text: async () => "no_service",
    } as unknown as Response));
    expect(
      await notifyAttention({ slackWebhookUrl: "https://hooks.slack.com/x" } as any, "x"),
    ).toBe(false);
  });
});

describe("dispatch-based notifiers surface delivery failures", () => {
  it("logs when Slack rejects the post instead of failing silently", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false, status: 403, statusText: "Forbidden", text: async () => "invalid_token",
    } as unknown as Response));

    // dispatch() uses Promise.allSettled, so a rejection is swallowed by design.
    // It must at least be logged, or a delivery outage is invisible.
    await notifyImageDefaultFallback(
      { slackWebhookUrl: "https://hooks.slack.com/x" } as any,
      { site: "dogslabs", articleTitle: "t", slug: "s", reason: "r" },
    );

    expect(errSpy).toHaveBeenCalled();
    const logged = errSpy.mock.calls.flat().map(String).join(" ");
    expect(logged.toLowerCase()).toContain("slack");
    errSpy.mockRestore();
  });
});
