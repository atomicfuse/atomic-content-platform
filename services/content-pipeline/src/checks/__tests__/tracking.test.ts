import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../../lib/kv.js", () => ({
  credentialsFor: () => ({ accountId: "a", token: "t" }),
  getKVEntry: vi.fn(),
}));

vi.mock("../../lib/cloudflare-accounts.js", () => ({
  getKvNamespaces: () => ({ staging: "s", prod: "p" }),
}));

import { getKVEntry } from "../../lib/kv.js";
import { readTracking } from "../tracking.js";

const mockGetKVEntry = vi.mocked(getKVEntry);

afterEach(() => {
  vi.clearAllMocks();
});

describe("readTracking", () => {
  it("returns state:ok with correct presence flags when config has partial tracking", async () => {
    mockGetKVEntry.mockResolvedValue({
      tracking: { ga4: "G-1", gtm: "", facebook_pixel: "123" },
    });

    const result = await readTracking("travelswire");

    expect(result).toEqual({
      state: "ok",
      ga4: true,
      gtm: false,
      pixel: true,
    });
  });

  it("returns state:ok with all false when config exists but has no tracking field", async () => {
    mockGetKVEntry.mockResolvedValue({ domain: "travelswire" });

    const result = await readTracking("travelswire");

    expect(result).toEqual({
      state: "ok",
      ga4: false,
      gtm: false,
      pixel: false,
    });
  });

  it("returns state:unknown and all false when getKVEntry throws", async () => {
    mockGetKVEntry.mockRejectedValue(new Error("KV read site-config:travelswire: 500"));

    const result = await readTracking("travelswire");

    expect(result).toEqual({
      state: "unknown",
      ga4: false,
      gtm: false,
      pixel: false,
    });
  });
});
