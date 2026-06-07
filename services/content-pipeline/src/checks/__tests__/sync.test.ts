import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../../lib/kv.js", () => ({
  credentialsFor: () => ({ accountId: "a", token: "t" }),
  getKVEntry: vi.fn(),
}));

vi.mock("../../lib/cloudflare-accounts.js", () => ({
  getKvNamespaces: () => ({ staging: "s", prod: "p" }),
}));

import { getKVEntry } from "../../lib/kv.js";
import { readSyncStatus } from "../sync.js";

const mockGetKVEntry = vi.mocked(getKVEntry);

afterEach(() => {
  vi.clearAllMocks();
});

describe("readSyncStatus", () => {
  it("returns state:ok, ok:false when sync-status has ok:false + error", async () => {
    mockGetKVEntry.mockResolvedValue({
      gitSha: "abc123",
      committedAt: "2026-06-01T10:00:00Z",
      syncedAt: "2026-06-01T10:01:00Z",
      ok: false,
      error: "x",
    });

    const result = await readSyncStatus("travelswire");

    expect(result).toEqual({
      state: "ok",
      ok: false,
      syncedAt: "2026-06-01T10:01:00Z",
      gitSha: "abc123",
      error: "x",
    });
  });

  it("returns state:ok, ok:true when sync-status has ok:true", async () => {
    mockGetKVEntry.mockResolvedValue({
      gitSha: "def456",
      committedAt: "2026-06-02T08:00:00Z",
      syncedAt: "2026-06-02T08:02:00Z",
      ok: true,
    });

    const result = await readSyncStatus("travelswire");

    expect(result.state).toBe("ok");
    expect(result.ok).toBe(true);
    expect(result.gitSha).toBe("def456");
    expect(result.syncedAt).toBe("2026-06-02T08:02:00Z");
    expect(result.error).toBeNull();
  });

  it("returns state:unknown when KV returns null (key absent)", async () => {
    mockGetKVEntry.mockResolvedValue(null);

    const result = await readSyncStatus("travelswire");

    expect(result).toEqual({
      state: "unknown",
      ok: null,
      syncedAt: null,
      gitSha: null,
      error: null,
    });
  });

  it("returns state:unknown and does not throw when getKVEntry throws", async () => {
    mockGetKVEntry.mockRejectedValue(new Error("KV read sync-status:travelswire: 500"));

    const result = await readSyncStatus("travelswire");

    expect(result.state).toBe("unknown");
    expect(result.ok).toBeNull();
    expect(result.syncedAt).toBeNull();
    expect(result.gitSha).toBeNull();
    expect(result.error).toBe("KV read sync-status:travelswire: 500");
  });
});
