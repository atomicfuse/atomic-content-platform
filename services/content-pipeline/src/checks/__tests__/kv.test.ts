import { describe, it, expect, vi, afterEach } from "vitest";
import { getKVEntry } from "../../lib/kv.js";
import { isDev1Domain, getKvNamespaces, getAccountId } from "../../lib/cloudflare-accounts.js";

afterEach(() => { vi.unstubAllGlobals(); });

describe("getKVEntry", () => {
  const creds = { accountId: "a", token: "t" };
  it("returns null on 404", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 404, ok: false } as Response));
    expect(await getKVEntry("ns", "sync-status:x", creds)).toBeNull();
  });
  it("parses JSON on 200", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200, ok: true, text: async () => JSON.stringify({ ok: true }) } as any));
    expect(await getKVEntry("ns", "k", creds)).toEqual({ ok: true });
  });
  it("throws on other non-OK", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 500, ok: false } as Response));
    await expect(getKVEntry("ns", "k", creds)).rejects.toThrow();
  });
});

describe("cloudflare-accounts", () => {
  it("routes dev1 vs assets", () => {
    expect(isDev1Domain("financenewsbase")).toBe(true);
    expect(isDev1Domain("travelswire")).toBe(false);
    expect(getAccountId("muvizzcom")).toBe("953511f6356ff606d84ac89bba3eff50");
    expect(getKvNamespaces("travelswire").prod).toBe("b258e47065274b8b8af1a0b6d6529c1d");
  });
});
