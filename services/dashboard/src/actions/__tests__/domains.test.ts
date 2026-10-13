import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSetDomainHidden = vi.fn();
const mockRevalidatePath = vi.fn();
vi.mock("@/lib/hidden-domains", () => ({
  readHiddenDomains: vi.fn().mockResolvedValue(new Set(["hidden.com"])),
  setDomainHidden: (...args: unknown[]) => mockSetDomainHidden(...args),
}));
vi.mock("@/lib/cloudflare", () => ({
  listZones: vi.fn(async (domain?: string) =>
    domain ? [] : [{ id: "z1", name: "hidden.com", status: "active" }, { id: "z2", name: "shown.com", status: "active" }],
  ),
}));
vi.mock("@/lib/db/dashboard-index", () => ({
  getDashboardIndex: vi.fn().mockResolvedValue({ sites: [] }),
}));
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args) }));

import { fetchDomains, setDomainHiddenAction } from "../domains";

describe("domains actions", () => {
  beforeEach(() => { vi.clearAllMocks(); mockSetDomainHidden.mockResolvedValue(undefined); });

  it("fetchDomains flags hidden zones but still lists them", async () => {
    const domains = await fetchDomains();
    expect(domains.map((d) => [d.domain, d.hidden])).toEqual([["hidden.com", true], ["shown.com", false]]);
  });

  it("setDomainHiddenAction saves a normalised name and refreshes the page", async () => {
    expect(await setDomainHiddenAction(" Foo.COM ", true)).toEqual({ ok: true });
    expect(mockSetDomainHidden).toHaveBeenCalledWith("foo.com", true);
    expect(mockRevalidatePath).toHaveBeenCalledWith("/settings/domains");
  });

  it("rejects something that isn't a domain without writing", async () => {
    const result = await setDomainHiddenAction("../org.yaml", true);
    expect(result.ok).toBe(false);
    expect(mockSetDomainHidden).not.toHaveBeenCalled();
  });

  it("returns the error when the commit fails", async () => {
    mockSetDomainHidden.mockRejectedValue(new Error("GitHub 500"));
    expect(await setDomainHiddenAction("a.com", false)).toEqual({ ok: false, error: "GitHub 500" });
  });
});
