import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { getMongoDb, closeMongo } from "../../lib/mongo.js";

let mem: MongoMemoryServer;

beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  process.env.MONGODB_URL = mem.getUri();
});

afterAll(async () => {
  await closeMongo();
  await mem.stop();
});

describe("mongo connection", () => {
  it("returns a usable Db and memoizes the client", async () => {
    const db1 = await getMongoDb();
    const db2 = await getMongoDb();
    expect(db1).toBe(db2); // memoized
    const ping = await db1.command({ ping: 1 });
    expect(ping.ok).toBe(1);
  });
});
