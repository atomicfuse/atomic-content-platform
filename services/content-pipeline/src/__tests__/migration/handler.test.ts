import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleActiveImport, handleEnqueueArticleImport } from "../../agents/migration/handler.js";
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

function createMockResponse(): MockResponse & ServerResponse {
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
  return res as MockResponse & ServerResponse;
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
    await handleActiveImport(req, res, redis as never);
    expect(res._statusCode).toBe(400);
  });

  it("returns 404 when no active import exists", async () => {
    const req = createMockRequest("/wp-migrate/active-import/example.com");
    const res = createMockResponse();
    await handleActiveImport(req, res, redis as never);
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
    await handleActiveImport(req, res, redis as never);

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
    await handleActiveImport(req, res, redis as never);

    expect(res._statusCode).toBe(200);
    const body = JSON.parse(res._body);
    expect(body.active).toBe(true);
    expect(body.jobId).toBe("job-456");
    expect(body.progress).toBeNull();
  });
});

function createQueueMock(): Record<string, unknown> {
  return {
    add: vi.fn(async () => ({ id: "bullmq-job-1" })),
  };
}

function createMockPostRequest(url: string, body: unknown): IncomingMessage {
  const bodyStr = JSON.stringify(body);
  const listeners = new Map<string, Array<(data?: unknown) => void>>();
  const req = {
    url,
    method: "POST",
    on(event: string, handler: (data?: unknown) => void) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event)!.push(handler);
      // Defer emission so the handler's Promise for "end" is registered before firing
      if (event === "end") {
        process.nextTick(() => {
          for (const fn of listeners.get("data") ?? []) fn(Buffer.from(bodyStr));
          for (const fn of listeners.get("end") ?? []) fn();
        });
      }
      return req;
    },
  };
  return req as unknown as IncomingMessage;
}

function createFullRedisMock(): Record<string, unknown> {
  const stringStore = new Map<string, string>();
  return {
    get: vi.fn(async (key: string) => stringStore.get(key) ?? null),
    set: vi.fn(async (key: string, value: string, ...args: unknown[]) => {
      const hasNX = args.includes("NX");
      if (hasNX && stringStore.has(key)) return null;
      stringStore.set(key, value);
      return "OK";
    }),
    del: vi.fn(async (key: string) => { stringStore.delete(key); return 1; }),
    _stringStore: stringStore,
  };
}

describe("handleEnqueueArticleImport", () => {
  let redis: ReturnType<typeof createFullRedisMock>;
  let queue: ReturnType<typeof createQueueMock>;

  beforeEach(() => {
    redis = createFullRedisMock();
    queue = createQueueMock();
  });

  it("returns 400 when siteDomain is missing", async () => {
    const req = createMockPostRequest("/wp-migrate/import-articles", { wpApiUrl: "https://example.com/wp-json/wp/v2/posts" });
    const res = createMockResponse();
    await handleEnqueueArticleImport(req, res, queue as never, redis as never);
    expect(res._statusCode).toBe(400);
  });

  it("returns 400 when wpApiUrl is missing", async () => {
    const req = createMockPostRequest("/wp-migrate/import-articles", { siteDomain: "example.com" });
    const res = createMockResponse();
    await handleEnqueueArticleImport(req, res, queue as never, redis as never);
    expect(res._statusCode).toBe(400);
  });

  it("returns 202 and enqueues job on success", async () => {
    const req = createMockPostRequest("/wp-migrate/import-articles", {
      siteDomain: "example.com",
      wpApiUrl: "https://example.com/wp-json/wp/v2/posts",
    });
    const res = createMockResponse();
    await handleEnqueueArticleImport(req, res, queue as never, redis as never);
    expect(res._statusCode).toBe(202);
    const body = JSON.parse(res._body);
    expect(body.jobId).toBeDefined();
    expect(body.siteDomain).toBe("example.com");
    expect(queue.add).toHaveBeenCalled();
  });

  it("returns 409 when import is already running for same site", async () => {
    const req1 = createMockPostRequest("/wp-migrate/import-articles", {
      siteDomain: "example.com",
      wpApiUrl: "https://example.com/wp-json/wp/v2/posts",
    });
    const res1 = createMockResponse();
    await handleEnqueueArticleImport(req1, res1, queue as never, redis as never);
    expect(res1._statusCode).toBe(202);

    const req2 = createMockPostRequest("/wp-migrate/import-articles", {
      siteDomain: "example.com",
      wpApiUrl: "https://example.com/wp-json/wp/v2/posts",
    });
    const res2 = createMockResponse();
    await handleEnqueueArticleImport(req2, res2, queue as never, redis as never);
    expect(res2._statusCode).toBe(409);
    expect(JSON.parse(res2._body).error).toContain("already running");
  });

  it("allows import for different site while one is running", async () => {
    const req1 = createMockPostRequest("/wp-migrate/import-articles", {
      siteDomain: "site-a.com",
      wpApiUrl: "https://site-a.com/wp-json/wp/v2/posts",
    });
    const res1 = createMockResponse();
    await handleEnqueueArticleImport(req1, res1, queue as never, redis as never);
    expect(res1._statusCode).toBe(202);

    const req2 = createMockPostRequest("/wp-migrate/import-articles", {
      siteDomain: "site-b.com",
      wpApiUrl: "https://site-b.com/wp-json/wp/v2/posts",
    });
    const res2 = createMockResponse();
    await handleEnqueueArticleImport(req2, res2, queue as never, redis as never);
    expect(res2._statusCode).toBe(202);
  });
});
