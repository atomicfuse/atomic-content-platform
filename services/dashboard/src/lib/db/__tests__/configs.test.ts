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

describe("org config helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("getOrgConfig returns the singleton org config", async () => {
    const { getOrgConfig } = await import("../configs.js");
    mockFindOne.mockResolvedValueOnce({ _id: "org", organization: "Atomic Labs" });
    const result = await getOrgConfig();
    expect(mockCollection).toHaveBeenCalledWith("org_config");
    expect(mockFindOne).toHaveBeenCalledWith({ _id: "org" });
    expect(result?.organization).toBe("Atomic Labs");
  });

  it("getOrgConfig returns null when no config exists", async () => {
    const { getOrgConfig } = await import("../configs.js");
    mockFindOne.mockResolvedValueOnce(null);
    const result = await getOrgConfig();
    expect(result).toBeNull();
  });

  it("upsertOrgConfig upserts with _id=org", async () => {
    const { upsertOrgConfig } = await import("../configs.js");
    mockUpdateOne.mockResolvedValueOnce({ acknowledged: true });
    await upsertOrgConfig({ organization: "Atomic Labs", tracking: { ga4: "G-123" } });
    expect(mockCollection).toHaveBeenCalledWith("org_config");
    expect(mockUpdateOne).toHaveBeenCalledWith(
      { _id: "org" },
      { $set: expect.objectContaining({ organization: "Atomic Labs", updatedAt: expect.any(Date) }) },
      { upsert: true },
    );
  });

  it("upsertOrgConfig swallows errors", async () => {
    const { upsertOrgConfig } = await import("../configs.js");
    mockUpdateOne.mockRejectedValueOnce(new Error("connection lost"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await upsertOrgConfig({ organization: "Test" });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("upsertOrgConfig failed"));
    warnSpy.mockRestore();
  });
});

describe("group config helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("getGroupConfig returns group by groupId", async () => {
    const { getGroupConfig } = await import("../configs.js");
    mockFindOne.mockResolvedValueOnce({ groupId: "travel", theme: "blue" });
    const result = await getGroupConfig("travel");
    expect(mockCollection).toHaveBeenCalledWith("group_configs");
    expect(mockFindOne).toHaveBeenCalledWith({ groupId: "travel" });
    expect(result?.groupId).toBe("travel");
  });

  it("getGroupConfig returns null when not found", async () => {
    const { getGroupConfig } = await import("../configs.js");
    mockFindOne.mockResolvedValueOnce(null);
    const result = await getGroupConfig("missing");
    expect(result).toBeNull();
  });

  it("listGroupConfigs returns sorted list", async () => {
    const { listGroupConfigs } = await import("../configs.js");
    const groups = [{ groupId: "finance" }, { groupId: "travel" }];
    mockToArray.mockResolvedValueOnce(groups);
    const result = await listGroupConfigs();
    expect(mockCollection).toHaveBeenCalledWith("group_configs");
    expect(mockFind).toHaveBeenCalledWith({});
    expect(result).toHaveLength(2);
  });

  it("upsertGroupConfig upserts with groupId key", async () => {
    const { upsertGroupConfig } = await import("../configs.js");
    mockUpdateOne.mockResolvedValueOnce({ acknowledged: true });
    await upsertGroupConfig("travel", { theme: "blue" });
    expect(mockUpdateOne).toHaveBeenCalledWith(
      { groupId: "travel" },
      { $set: expect.objectContaining({ groupId: "travel", theme: "blue", updatedAt: expect.any(Date) }) },
      { upsert: true },
    );
  });

  it("upsertGroupConfig swallows errors", async () => {
    const { upsertGroupConfig } = await import("../configs.js");
    mockUpdateOne.mockRejectedValueOnce(new Error("write error"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await upsertGroupConfig("travel", { theme: "blue" });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("upsertGroupConfig failed"));
    warnSpy.mockRestore();
  });

  it("deleteGroupConfig deletes by groupId", async () => {
    const { deleteGroupConfig } = await import("../configs.js");
    mockDeleteOne.mockResolvedValueOnce({ acknowledged: true });
    await deleteGroupConfig("travel");
    expect(mockCollection).toHaveBeenCalledWith("group_configs");
    expect(mockDeleteOne).toHaveBeenCalledWith({ groupId: "travel" });
  });

  it("deleteGroupConfig swallows errors", async () => {
    const { deleteGroupConfig } = await import("../configs.js");
    mockDeleteOne.mockRejectedValueOnce(new Error("timeout"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await deleteGroupConfig("travel");
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("deleteGroupConfig failed"));
    warnSpy.mockRestore();
  });
});

describe("override config helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("getOverrideConfig returns override by overrideId", async () => {
    const { getOverrideConfig } = await import("../configs.js");
    mockFindOne.mockResolvedValueOnce({ overrideId: "sticky-ads", priority: 10 });
    const result = await getOverrideConfig("sticky-ads");
    expect(mockCollection).toHaveBeenCalledWith("override_configs");
    expect(mockFindOne).toHaveBeenCalledWith({ overrideId: "sticky-ads" });
    expect(result?.priority).toBe(10);
  });

  it("listOverrideConfigs returns sorted list", async () => {
    const { listOverrideConfigs } = await import("../configs.js");
    const overrides = [{ overrideId: "override-a" }, { overrideId: "override-b" }];
    mockToArray.mockResolvedValueOnce(overrides);
    const result = await listOverrideConfigs();
    expect(mockCollection).toHaveBeenCalledWith("override_configs");
    expect(result).toHaveLength(2);
  });

  it("upsertOverrideConfig upserts with overrideId key", async () => {
    const { upsertOverrideConfig } = await import("../configs.js");
    mockUpdateOne.mockResolvedValueOnce({ acknowledged: true });
    await upsertOverrideConfig("sticky-ads", { priority: 10, targets: { groups: ["travel"] } });
    expect(mockUpdateOne).toHaveBeenCalledWith(
      { overrideId: "sticky-ads" },
      { $set: expect.objectContaining({ overrideId: "sticky-ads", priority: 10, updatedAt: expect.any(Date) }) },
      { upsert: true },
    );
  });

  it("deleteOverrideConfig deletes by overrideId", async () => {
    const { deleteOverrideConfig } = await import("../configs.js");
    mockDeleteOne.mockResolvedValueOnce({ acknowledged: true });
    await deleteOverrideConfig("sticky-ads");
    expect(mockCollection).toHaveBeenCalledWith("override_configs");
    expect(mockDeleteOne).toHaveBeenCalledWith({ overrideId: "sticky-ads" });
  });

  it("deleteOverrideConfig swallows errors", async () => {
    const { deleteOverrideConfig } = await import("../configs.js");
    mockDeleteOne.mockRejectedValueOnce(new Error("network error"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await deleteOverrideConfig("sticky-ads");
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("deleteOverrideConfig failed"));
    warnSpy.mockRestore();
  });
});

describe("scheduler config helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("getSchedulerConfig returns the singleton scheduler config", async () => {
    const { getSchedulerConfig } = await import("../configs.js");
    mockFindOne.mockResolvedValueOnce({ _id: "scheduler", enabled: true, run_at_hours: [14] });
    const result = await getSchedulerConfig();
    expect(mockCollection).toHaveBeenCalledWith("scheduler_config");
    expect(mockFindOne).toHaveBeenCalledWith({ _id: "scheduler" });
    expect(result?.enabled).toBe(true);
  });

  it("getSchedulerConfig returns null when no config exists", async () => {
    const { getSchedulerConfig } = await import("../configs.js");
    mockFindOne.mockResolvedValueOnce(null);
    const result = await getSchedulerConfig();
    expect(result).toBeNull();
  });

  it("upsertSchedulerConfig upserts with _id=scheduler", async () => {
    const { upsertSchedulerConfig } = await import("../configs.js");
    mockUpdateOne.mockResolvedValueOnce({ acknowledged: true });
    await upsertSchedulerConfig({ enabled: true, run_at_hours: [14], timezone: "EST" });
    expect(mockCollection).toHaveBeenCalledWith("scheduler_config");
    expect(mockUpdateOne).toHaveBeenCalledWith(
      { _id: "scheduler" },
      { $set: expect.objectContaining({ enabled: true, run_at_hours: [14], updatedAt: expect.any(Date) }) },
      { upsert: true },
    );
  });

  it("upsertSchedulerConfig swallows errors", async () => {
    const { upsertSchedulerConfig } = await import("../configs.js");
    mockUpdateOne.mockRejectedValueOnce(new Error("write concern"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await upsertSchedulerConfig({ enabled: false });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("upsertSchedulerConfig failed"));
    warnSpy.mockRestore();
  });
});
