import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleActiveImport } from "../../agents/migration/handler.js";
import type { IncomingMessage, ServerResponse } from "node:http";

function createMockRequest(url: string): IncomingMessage {
  return { url, method: "GET" } as unknown as IncomingMessage;
}

interface MockResponse {
  _statusCode: number;
  _body: string;
  _headers: Record<string, string>;
  writeHead: (code: number, headers?: Record<string, string>) => void;
  end: (body?: string) => void;
}

function createMockResponse(): MockResponse {
  const res: MockResponse = {
    _statusCode: 0,
    _body: "",
    _headers: {},
    writeHead(code: number, headers?: Record<string, string>) {
      res._statusCode = code;
      if (headers) res._headers = headers;
    },
    end(body?: string) {
      res._body = body ?? "";
    },
  };
  return res;
}

interface RedisMock {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  _stringStore: Map<string, string>;
}

function createRedisMock(): RedisMock {
  const stringStore = new Map<string, string>();
  return {
    get: vi.fn(async (key: string) => stringStore.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      stringStore.set(key, value);
      return "OK";
    }),
    _stringStore: stringStore,
  };
}

describe("handleActiveImport", () => {
  let redis: RedisMock;

  beforeEach(() => {
    redis = createRedisMock();
  });

  it("returns 400 when domain is missing from URL", async () => {
    const req = createMockRequest("/wp-migrate/active-import/");
    const res = createMockResponse();
    await handleActiveImport(req, res as unknown as ServerResponse, redis as never);
    expect(res._statusCode).toBe(400);
  });

  it("returns 404 when no active import exists", async () => {
    const req = createMockRequest("/wp-migrate/active-import/example.com");
    const res = createMockResponse();
    await handleActiveImport(req, res as unknown as ServerResponse, redis as never);
    expect(res._statusCode).toBe(404);
    expect(JSON.parse(res._body)).toEqual({ active: false });
  });

  it("returns 200 with jobId and progress when import is active", async () => {
    redis._stringStore.set("article-import-active:example.com", "job-123");
    const progress = {
      jobId: "job-123",
      site: "example.com",
      status: "running",
      phase: "fetching",
      totalArticles: 10,
      processedArticles: 3,
      successfulArticles: 2,
      failedArticles: 1,
    };
    redis._stringStore.set("article-import:job-123", JSON.stringify(progress));

    const req = createMockRequest("/wp-migrate/active-import/example.com");
    const res = createMockResponse();
    await handleActiveImport(req, res as unknown as ServerResponse, redis as never);

    expect(res._statusCode).toBe(200);
    const body = JSON.parse(res._body);
    expect(body.active).toBe(true);
    expect(body.jobId).toBe("job-123");
    expect(body.progress.status).toBe("running");
  });

  it("returns 200 with jobId but null progress when lock exists but progress expired", async () => {
    redis._stringStore.set("article-import-active:example.com", "job-456");

    const req = createMockRequest("/wp-migrate/active-import/example.com");
    const res = createMockResponse();
    await handleActiveImport(req, res as unknown as ServerResponse, redis as never);

    expect(res._statusCode).toBe(200);
    const body = JSON.parse(res._body);
    expect(body.active).toBe(true);
    expect(body.jobId).toBe("job-456");
    expect(body.progress).toBeNull();
  });
});
