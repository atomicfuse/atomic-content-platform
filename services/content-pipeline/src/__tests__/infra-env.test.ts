import { describe, expect, it } from "vitest";
import { mongoUrl, redisUrl } from "../lib/infra-env.js";

describe("infra env (requires: v1 names and needs: v2 names)", () => {
  it("uses the v2 needs: names when only they are injected", () => {
    expect(mongoUrl({ DATABASE_MONGODB_URL: "mongodb://v2" })).toBe("mongodb://v2");
    expect(redisUrl({ QUEUE_REDIS_URL: "redis://v2" })).toBe("redis://v2");
  });
  it("prefers an explicit/legacy name (local .env overrides keep working)", () => {
    expect(mongoUrl({ MONGODB_URL: "mongodb://old", DATABASE_MONGODB_URL: "mongodb://v2" })).toBe("mongodb://old");
    expect(mongoUrl({ MONGODB_URI: "mongodb://uri" })).toBe("mongodb://uri");
    expect(redisUrl({ REDIS_URL: "redis://localhost:6379", QUEUE_REDIS_URL: "redis://v2" })).toBe("redis://localhost:6379");
  });
  it("is undefined when nothing is set", () => {
    expect(mongoUrl({})).toBeUndefined();
    expect(redisUrl({})).toBeUndefined();
  });
});
