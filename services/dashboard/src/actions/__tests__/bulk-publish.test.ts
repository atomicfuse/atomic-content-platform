import { describe, it, expect, vi, beforeEach } from "vitest";

// The real publish path (GitHub, KV, R2, Mongo) is never loaded.
const publishMock = vi.fn();
vi.mock("@/actions/wizard", () => ({
  publishStagingToProduction: (...args: unknown[]) => publishMock(...args),
}));

import { bulkPublishSite } from "../bulk-publish";

beforeEach(() => {
  publishMock.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("bulkPublishSite", () => {
  it("calls publishStagingToProduction for the domain and returns ok", async () => {
    publishMock.mockResolvedValue(undefined);
    await expect(bulkPublishSite("coolnews.com")).resolves.toEqual({ ok: true });
    expect(publishMock).toHaveBeenCalledWith("coolnews.com");
    expect(publishMock).toHaveBeenCalledTimes(1);
  });

  it("returns the error message as data instead of throwing", async () => {
    const err = Object.assign(new Error("No staging branch found for coolnews.com"), {
      request: { headers: { authorization: "token secret" } },
    });
    publishMock.mockRejectedValue(err);
    const result = await bulkPublishSite("coolnews.com");
    expect(result).toEqual({ ok: false, error: "No staging branch found for coolnews.com" });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("falls back to a generic message for non-Error throws and caps long messages", async () => {
    publishMock.mockRejectedValueOnce("weird");
    expect(await bulkPublishSite("a")).toEqual({ ok: false, error: "Publish failed" });
    publishMock.mockRejectedValueOnce(new Error("x".repeat(2000)));
    const long = await bulkPublishSite("a");
    expect(long.ok).toBe(false);
    if (!long.ok) expect(long.error).toHaveLength(500);
  });
});
