import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/github", () => ({
  readFileContent: vi.fn(async () => null),
  commitNetworkFiles: vi.fn(),
}));
vi.mock("@/lib/cloudflare", () => ({
  getCredentials: vi.fn(() => ({ accountId: "acct", token: "tok" })),
  headersFromCreds: vi.fn(() => ({ Authorization: "Bearer tok" })),
}));

import { createEmailRoutingRule, enableEmailRouting } from "../email-routing";

interface Call { url: string; method: string }

const AUTH_ERROR = { success: false, result: null, errors: [{ code: 10000, message: "Authentication error" }] };

function mockCloudflare(routes: Record<string, unknown>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const path = url.replace("https://api.cloudflare.com/client/v4", "");
    calls.push({ url: path, method });
    const body = routes[`${method} ${path}`];
    if (body === undefined) throw new Error(`unexpected ${method} ${path}`);
    return { json: async () => body } as Response;
  }));
  return calls;
}

describe("enableEmailRouting", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("turns routing on via POST /email/routing/dns when the zone is unconfigured", async () => {
    const calls = mockCloudflare({
      "GET /zones/z1/email/routing": { success: true, result: { enabled: false }, errors: [] },
      "POST /zones/z1/email/routing/dns": { success: true, result: { enabled: true, status: "ready" }, errors: [] },
    });
    await enableEmailRouting("z1", "site");
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "GET /zones/z1/email/routing",
      "POST /zones/z1/email/routing/dns",
    ]);
  });

  it("does nothing when routing is already enabled", async () => {
    const calls = mockCloudflare({
      "GET /zones/z1/email/routing": { success: true, result: { enabled: true }, errors: [] },
    });
    await enableEmailRouting("z1", "site");
    expect(calls).toHaveLength(1);
  });

  it("throws when the token lacks Zone Settings permission instead of silently continuing", async () => {
    mockCloudflare({
      "GET /zones/z1/email/routing": AUTH_ERROR,
      "POST /zones/z1/email/routing/dns": AUTH_ERROR,
    });
    await expect(enableEmailRouting("z1", "site")).rejects.toThrow(/Zone Settings/);
  });
});

describe("createEmailRoutingRule", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("throws on an auth error instead of returning null", async () => {
    mockCloudflare({
      "GET /zones/z1/email/routing/rules": { success: true, result: [], errors: [] },
      "POST /zones/z1/email/routing/rules": AUTH_ERROR,
    });
    await expect(createEmailRoutingRule("z1", "site.com", "dest@x.io")).rejects.toThrow(/Email Routing Rules/);
  });

  it("returns the existing rule for info@<domain> without creating a duplicate", async () => {
    const rule = { id: "r1", name: "", enabled: true, matchers: [{ type: "literal", field: "to", value: "info@site.com" }], actions: [] };
    const calls = mockCloudflare({
      "GET /zones/z1/email/routing/rules": { success: true, result: [rule], errors: [] },
    });
    await expect(createEmailRoutingRule("z1", "site.com", "dest@x.io")).resolves.toEqual(rule);
    expect(calls).toHaveLength(1);
  });
});
