import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock mongodb module — MongoClient is instantiated with `new`, then .connect() is called
const mockDb = { collection: vi.fn() };
const mockClient = {
  connect: vi.fn().mockResolvedValue(undefined),
  db: vi.fn(() => mockDb),
  close: vi.fn(),
};

// When `new MongoClient(url, opts)` is called, return our mock.
// `.connect()` resolves to the client itself (matching real driver behaviour).
mockClient.connect.mockResolvedValue(mockClient);

vi.mock("mongodb", () => ({
  MongoClient: vi.fn(() => mockClient),
}));

describe("getMongoDb", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.MONGODB_URL = "mongodb://localhost:27017/test_db";
  });

  afterEach(() => {
    delete process.env.MONGODB_URL;
    delete process.env.MONGODB_URI;
    delete process.env.MONGODB_DB;
  });

  it("returns a Db instance from MONGODB_URL", async () => {
    const { getMongoDb } = await import("../mongo.js");
    const db = await getMongoDb();
    expect(db).toBe(mockDb);
  });

  it("throws if no MONGODB_URL or MONGODB_URI is set", async () => {
    delete process.env.MONGODB_URL;
    const { getMongoDb } = await import("../mongo.js");
    await expect(getMongoDb()).rejects.toThrow("MONGODB_URL");
  });

  it("memoizes — returns same promise on second call", async () => {
    const { getMongoDb } = await import("../mongo.js");
    const db1 = await getMongoDb();
    const db2 = await getMongoDb();
    expect(db1).toBe(db2);
  });
});
