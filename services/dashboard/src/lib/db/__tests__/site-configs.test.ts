import { describe, it, expect, vi, beforeEach } from "vitest";

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
