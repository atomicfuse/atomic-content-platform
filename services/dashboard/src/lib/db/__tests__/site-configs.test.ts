import { describe, it, expect, vi, beforeEach } from "vitest";

// Enable MongoDB reads for these tests (otherwise feature flag falls back to Git)
process.env.USE_MONGO_READS = "true";

const mockToArray = vi.fn();
const mockFindOne = vi.fn();
const mockUpdateOne = vi.fn();
const mockDeleteOne = vi.fn();
const mockFind = vi.fn(() => ({
  sort: vi.fn().mockReturnThis(),
  toArray: mockToArray,
}));
const mockCollection = vi.fn(() => ({
  find: mockFind,
  findOne: mockFindOne,
  updateOne: mockUpdateOne,
  deleteOne: mockDeleteOne,
}));
const mockDb = { collection: mockCollection };

vi.mock("../../mongo.js", () => ({
  getMongoDb: vi.fn(() => Promise.resolve(mockDb)),
}));

describe("site-config DB helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("getSiteConfig returns config for a domain", async () => {
    const { getSiteConfig } = await import("../site-configs.js");
    mockFindOne.mockResolvedValueOnce({ domain: "example.com", theme: "dark" });
    const result = await getSiteConfig("example.com");
    expect(mockCollection).toHaveBeenCalledWith("site_configs");
    expect(mockFindOne).toHaveBeenCalledWith({ domain: "example.com" });
    expect(result).toEqual({ domain: "example.com", theme: "dark" });
  });

  it("getSiteConfig returns null when not found", async () => {
    const { getSiteConfig } = await import("../site-configs.js");
    mockFindOne.mockResolvedValueOnce(null);
    const result = await getSiteConfig("missing.com");
    expect(result).toBeNull();
  });

  it("listSiteConfigs returns sorted list", async () => {
    const { listSiteConfigs } = await import("../site-configs.js");
    const configs = [
      { domain: "alpha.com", theme: "light" },
      { domain: "beta.com", theme: "dark" },
    ];
    mockToArray.mockResolvedValueOnce(configs);
    const result = await listSiteConfigs();
    expect(mockCollection).toHaveBeenCalledWith("site_configs");
    expect(mockFind).toHaveBeenCalledWith({});
    expect(result).toEqual(configs);
    expect(result).toHaveLength(2);
  });

  it("upsertSiteConfig upserts with domain key", async () => {
    const { upsertSiteConfig } = await import("../site-configs.js");
    mockUpdateOne.mockResolvedValueOnce({ acknowledged: true });
    await upsertSiteConfig("example.com", { theme: "dark", groups: ["g1"] });
    expect(mockCollection).toHaveBeenCalledWith("site_configs");
    expect(mockUpdateOne).toHaveBeenCalledWith(
      { domain: "example.com" },
      { $set: expect.objectContaining({ domain: "example.com", theme: "dark", groups: ["g1"], updatedAt: expect.any(Date) }) },
      { upsert: true },
    );
  });

  it("upsertSiteConfig swallows errors", async () => {
    const { upsertSiteConfig } = await import("../site-configs.js");
    mockUpdateOne.mockRejectedValueOnce(new Error("connection lost"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await upsertSiteConfig("example.com", { theme: "dark" });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("upsertSiteConfig failed"));
    warnSpy.mockRestore();
  });

  // The collection is keyed on the siteId (the site folder name), which for
  // CSV-imported sites is the domain with its TLD stripped. Stamping that key
  // over config.domain is what reverted `buzzsoaps.com` back to `buzzsoaps`
  // in site.yaml on every dashboard save.
  it("upsertSiteConfig preserves the config's real domain alongside the key", async () => {
    const { upsertSiteConfig } = await import("../site-configs.js");
    mockUpdateOne.mockResolvedValueOnce({ acknowledged: true });
    await upsertSiteConfig("buzzsoaps", { domain: "buzzsoaps.com", theme: "dark" });
    expect(mockUpdateOne).toHaveBeenCalledWith(
      { domain: "buzzsoaps" },
      {
        $set: expect.objectContaining({
          domain: "buzzsoaps",
          site_domain: "buzzsoaps.com",
          theme: "dark",
        }),
      },
      { upsert: true },
    );
  });

  it("upsertSiteConfig does not record a site_domain that is only the siteId", async () => {
    const { upsertSiteConfig } = await import("../site-configs.js");
    mockUpdateOne.mockResolvedValueOnce({ acknowledged: true });
    await upsertSiteConfig("buzzsoaps", { domain: "buzzsoaps", theme: "dark" });
    const [, update] = mockUpdateOne.mock.calls[0]!;
    expect(update.$set.domain).toBe("buzzsoaps");
    expect(update.$set.site_domain).toBeUndefined();
  });

  it("getSiteConfig restores the real domain from site_domain", async () => {
    const { getSiteConfig } = await import("../site-configs.js");
    mockFindOne.mockResolvedValueOnce({
      _id: "x",
      domain: "buzzsoaps",
      site_domain: "buzzsoaps.com",
      theme: "dark",
      updatedAt: new Date(),
    });
    const result = await getSiteConfig("buzzsoaps");
    expect(result).toEqual({ domain: "buzzsoaps.com", theme: "dark" });
  });

  it("getSiteConfig round-trips a real domain unchanged", async () => {
    const { upsertSiteConfig, getSiteConfig } = await import("../site-configs.js");
    mockUpdateOne.mockResolvedValueOnce({ acknowledged: true });
    await upsertSiteConfig("buzzsoaps", { domain: "buzzsoaps.com", theme: "dark" });
    const [, update] = mockUpdateOne.mock.calls[0]!;
    mockFindOne.mockResolvedValueOnce({ _id: "x", ...update.$set });
    expect(await getSiteConfig("buzzsoaps")).toEqual({
      domain: "buzzsoaps.com",
      theme: "dark",
    });
  });

  it("getSiteConfig leaves legacy docs without site_domain untouched", async () => {
    const { getSiteConfig } = await import("../site-configs.js");
    mockFindOne.mockResolvedValueOnce({ _id: "x", domain: "buzzsoaps", theme: "dark" });
    expect(await getSiteConfig("buzzsoaps")).toEqual({
      domain: "buzzsoaps",
      theme: "dark",
    });
  });

  it("deleteSiteConfig deletes by domain", async () => {
    const { deleteSiteConfig } = await import("../site-configs.js");
    mockDeleteOne.mockResolvedValueOnce({ acknowledged: true });
    await deleteSiteConfig("example.com");
    expect(mockCollection).toHaveBeenCalledWith("site_configs");
    expect(mockDeleteOne).toHaveBeenCalledWith({ domain: "example.com" });
  });

  it("deleteSiteConfig swallows errors", async () => {
    const { deleteSiteConfig } = await import("../site-configs.js");
    mockDeleteOne.mockRejectedValueOnce(new Error("timeout"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await deleteSiteConfig("example.com");
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("deleteSiteConfig failed"));
    warnSpy.mockRestore();
  });
});
