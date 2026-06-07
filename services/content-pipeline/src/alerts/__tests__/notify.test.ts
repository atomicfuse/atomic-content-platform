import { describe, it, expect, vi, afterEach } from "vitest";
import { notifyAttention } from "../../lib/notifications.js";

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
});
