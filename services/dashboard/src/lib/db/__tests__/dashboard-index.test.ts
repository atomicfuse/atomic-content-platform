import { describe, it, expect, vi, beforeEach } from "vitest";

const mockToArray = vi.fn();
const mockFindOne = vi.fn();
const mockUpdateOne = vi.fn();
const mockFind = vi.fn(() => ({
  sort: vi.fn().mockReturnThis(),
  toArray: mockToArray,
}));
const mockCollection = vi.fn(() => ({
  find: mockFind,
  findOne: mockFindOne,
  updateOne: mockUpdateOne,
}));
const mockDb = { collection: mockCollection };

vi.mock("../../mongo.js", () => ({
  getMongoDb: vi.fn(() => Promise.resolve(mockDb)),
}));

describe("dashboard-index DB helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("getDashboardIndex returns non-deleted entries sorted by domain", async () => {
    const { getDashboardIndex } = await import("../dashboard-index.js");
    const entries = [
      { domain: "alpha.com", status: "live" },
      { domain: "beta.com", status: "staging" },
    ];
    mockToArray.mockResolvedValueOnce(entries);
    const result = await getDashboardIndex();
    expect(mockCollection).toHaveBeenCalledWith("dashboard_index");
    expect(mockFind).toHaveBeenCalledWith({ status: { $ne: "deleted" } });
    expect(result).toEqual(entries);
  });

  it("getDashboardEntry returns a single entry or null", async () => {
    const { getDashboardEntry } = await import("../dashboard-index.js");
    mockFindOne.mockResolvedValueOnce({ domain: "example.com", status: "live" });
    const result = await getDashboardEntry("example.com");
    expect(mockCollection).toHaveBeenCalledWith("dashboard_index");
    expect(mockFindOne).toHaveBeenCalledWith({ domain: "example.com" });
    expect(result?.status).toBe("live");
  });

  it("getDashboardEntry returns null when not found", async () => {
    const { getDashboardEntry } = await import("../dashboard-index.js");
    mockFindOne.mockResolvedValueOnce(null);
    const result = await getDashboardEntry("missing.com");
    expect(result).toBeNull();
  });

  it("upsertDashboardIndexEntry upserts with domain key", async () => {
    const { upsertDashboardIndexEntry } = await import("../dashboard-index.js");
    mockUpdateOne.mockResolvedValueOnce({ acknowledged: true });
    await upsertDashboardIndexEntry("example.com", { status: "live", custom_domain: "example.com" });
    expect(mockCollection).toHaveBeenCalledWith("dashboard_index");
    expect(mockUpdateOne).toHaveBeenCalledWith(
      { domain: "example.com" },
      { $set: expect.objectContaining({ domain: "example.com", status: "live", updatedAt: expect.any(Date) }) },
      { upsert: true },
    );
  });

  it("upsertDashboardIndexEntry swallows errors", async () => {
    const { upsertDashboardIndexEntry } = await import("../dashboard-index.js");
    mockUpdateOne.mockRejectedValueOnce(new Error("write concern"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await upsertDashboardIndexEntry("example.com", { status: "live" });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("upsertDashboardIndexEntry failed"));
    warnSpy.mockRestore();
  });

  it("updateDashboardIndexEntry updates without upsert", async () => {
    const { updateDashboardIndexEntry } = await import("../dashboard-index.js");
    mockUpdateOne.mockResolvedValueOnce({ acknowledged: true });
    await updateDashboardIndexEntry("example.com", { status: "staging" });
    expect(mockUpdateOne).toHaveBeenCalledWith(
      { domain: "example.com" },
      { $set: expect.objectContaining({ status: "staging", updatedAt: expect.any(Date) }) },
    );
    // Should NOT have upsert option
    expect(mockUpdateOne.mock.calls[0]).toHaveLength(2);
  });

  it("updateDashboardIndexEntry swallows errors", async () => {
    const { updateDashboardIndexEntry } = await import("../dashboard-index.js");
    mockUpdateOne.mockRejectedValueOnce(new Error("timeout"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await updateDashboardIndexEntry("example.com", { status: "staging" });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("updateDashboardIndexEntry failed"));
    warnSpy.mockRestore();
  });

  it("addToDeleteHistory sets status and pushes history entry", async () => {
    const { addToDeleteHistory } = await import("../dashboard-index.js");
    mockUpdateOne.mockResolvedValueOnce({ acknowledged: true });
    const historyEntry = { action: "permanent_delete", deletedAt: "2026-06-17" };
    await addToDeleteHistory("example.com", historyEntry);
    expect(mockCollection).toHaveBeenCalledWith("dashboard_index");
    expect(mockUpdateOne).toHaveBeenCalledWith(
      { domain: "example.com" },
      {
        $set: { status: "permanently_deleted", updatedAt: expect.any(Date) },
        $push: { history: historyEntry },
      },
    );
  });

  it("addToDeleteHistory swallows errors", async () => {
    const { addToDeleteHistory } = await import("../dashboard-index.js");
    mockUpdateOne.mockRejectedValueOnce(new Error("duplicate key"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await addToDeleteHistory("example.com", { action: "delete" });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("addToDeleteHistory failed"));
    warnSpy.mockRestore();
  });
});
