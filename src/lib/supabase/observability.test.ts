import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockLogError = vi.fn();

vi.mock("@/lib/logger", () => ({
  logError: (...args: unknown[]) => mockLogError(...args),
  logWarn: vi.fn(),
  logInfo: vi.fn(),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeResponse(
  status: number,
  body = "",
  headers: Record<string, string> = {},
): Response {
  return new Response(body, { status, headers });
}

function makeFetch(response: Response): typeof fetch {
  return vi.fn().mockResolvedValue(response) as unknown as typeof fetch;
}

// ─── Import after mocks ───────────────────────────────────────────────────────

import { createObservedFetch } from "./observability";

// ─── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

const SUPABASE_REST = "https://xyz.supabase.co/rest/v1/profiles?select=*";
const SUPABASE_STORAGE = "https://xyz.supabase.co/storage/v1/object/avatar.png";
const SUPABASE_AUTH = "https://xyz.supabase.co/auth/v1/token";
const EXTERNAL_URL = "https://api.example.com/data";

describe("createObservedFetch — 2xx pass-through", () => {
  it("returns the response unchanged on 200 for a Supabase REST URL", async () => {
    const response = makeResponse(200, "[]");
    const observed = createObservedFetch(makeFetch(response));

    const result = await observed(SUPABASE_REST, {});

    expect(result).toBe(response);
    expect(mockLogError).not.toHaveBeenCalled();
  });

  it("does NOT log on 204 No Content", async () => {
    // 204 cannot carry a body per the Fetch spec
    const response = new Response(null, { status: 204 });
    const observed = createObservedFetch(makeFetch(response));

    await observed(SUPABASE_REST, {});

    expect(mockLogError).not.toHaveBeenCalled();
  });

  it("does NOT log on 201 Created (storage upload)", async () => {
    const response = makeResponse(201);
    const observed = createObservedFetch(makeFetch(response));

    await observed(SUPABASE_STORAGE, { method: "POST" });

    expect(mockLogError).not.toHaveBeenCalled();
  });
});

describe("createObservedFetch — non-Supabase URLs", () => {
  it("passes through a non-Supabase URL without logging even on 500", async () => {
    const response = makeResponse(500, "server error");
    const observed = createObservedFetch(makeFetch(response));

    const result = await observed(EXTERNAL_URL, {});

    expect(result).toBe(response);
    expect(mockLogError).not.toHaveBeenCalled();
  });

  it("passes through on 404 for a non-Supabase URL", async () => {
    const response = makeResponse(404, "not found");
    const observed = createObservedFetch(makeFetch(response));

    await observed(EXTERNAL_URL, {});

    expect(mockLogError).not.toHaveBeenCalled();
  });
});

describe("createObservedFetch — auth/v1 4xx suppression", () => {
  it("does NOT log auth/v1 401 (expected: invalid credentials, expired token)", async () => {
    const response = makeResponse(401, '{"error":"invalid_credentials"}');
    const observed = createObservedFetch(makeFetch(response));

    await observed(SUPABASE_AUTH, { method: "POST" });

    expect(mockLogError).not.toHaveBeenCalled();
  });

  it("does NOT log auth/v1 400 (expected: user-facing validation)", async () => {
    const response = makeResponse(400, '{"error":"email_not_confirmed"}');
    const observed = createObservedFetch(makeFetch(response));

    await observed(SUPABASE_AUTH, {});

    expect(mockLogError).not.toHaveBeenCalled();
  });

  it("DOES log auth/v1 500 (unexpected server error)", async () => {
    const response = makeResponse(500, '{"message":"Internal Server Error"}');
    const observed = createObservedFetch(makeFetch(response));

    await observed(SUPABASE_AUTH, {});

    expect(mockLogError).toHaveBeenCalledTimes(1);
  });
});

describe("createObservedFetch — rest/v1 errors", () => {
  it("logs logError on 403 for a REST URL", async () => {
    const response = makeResponse(403, '{"code":"42501","message":"permission denied"}');
    const observed = createObservedFetch(makeFetch(response));

    await observed(SUPABASE_REST, { method: "POST" });

    expect(mockLogError).toHaveBeenCalledTimes(1);
    const [msg] = mockLogError.mock.calls[0] as [string, ...unknown[]];
    expect(msg).toContain("supabase.silent_fail");
    expect(msg).toContain("403");
  });

  it("logs logError on 404 for a REST URL", async () => {
    const response = makeResponse(404, '{"message":"not found"}');
    const observed = createObservedFetch(makeFetch(response));

    await observed(SUPABASE_REST, {});

    expect(mockLogError).toHaveBeenCalledTimes(1);
  });

  it("logs logError on 500 with severity=critical", async () => {
    const response = makeResponse(500, "internal error");
    const observed = createObservedFetch(makeFetch(response));

    await observed(SUPABASE_REST, {});

    const [, , ctx] = mockLogError.mock.calls[0] as [
      string,
      Error,
      { severity?: string },
    ];
    expect(ctx.severity).toBe("critical");
  });

  it("logs logError on 4xx with severity=warning", async () => {
    const response = makeResponse(403, "forbidden");
    const observed = createObservedFetch(makeFetch(response));

    await observed(SUPABASE_REST, {});

    const [, , ctx] = mockLogError.mock.calls[0] as [
      string,
      Error,
      { severity?: string },
    ];
    expect(ctx.severity).toBe("warning");
  });

  it("includes the HTTP method in the log message", async () => {
    const response = makeResponse(422, "unprocessable");
    const observed = createObservedFetch(makeFetch(response));

    await observed(SUPABASE_REST, { method: "PATCH" });

    const [msg] = mockLogError.mock.calls[0] as [string];
    expect(msg).toContain("PATCH");
  });

  it("defaults method to GET when init is undefined", async () => {
    const response = makeResponse(403, "forbidden");
    const observed = createObservedFetch(makeFetch(response));

    await observed(SUPABASE_REST);

    const [msg] = mockLogError.mock.calls[0] as [string];
    expect(msg).toContain("GET");
  });

  it("returns the original response even after logging (pass-through)", async () => {
    const response = makeResponse(403, "forbidden");
    const observed = createObservedFetch(makeFetch(response));

    const result = await observed(SUPABASE_REST, {});

    expect(result).toBe(response);
  });
});

describe("createObservedFetch — URL input variants", () => {
  it("handles URL object input", async () => {
    const response = makeResponse(200);
    const baseFetch = makeFetch(response);
    const observed = createObservedFetch(baseFetch);

    await observed(new URL(SUPABASE_REST), {});

    expect(mockLogError).not.toHaveBeenCalled();
  });

  it("handles Request object input", async () => {
    const response = makeResponse(200);
    const baseFetch = makeFetch(response);
    const observed = createObservedFetch(baseFetch);

    await observed(new Request(SUPABASE_REST), {});

    expect(mockLogError).not.toHaveBeenCalled();
  });

  it("handles storage/v1 URL", async () => {
    const response = makeResponse(403, "forbidden");
    const observed = createObservedFetch(makeFetch(response));

    await observed(SUPABASE_STORAGE, {});

    expect(mockLogError).toHaveBeenCalledTimes(1);
  });
});

describe("createObservedFetch — body read failure", () => {
  it("still logs even if response.clone().text() throws", async () => {
    const response = makeResponse(500, "err");
    vi.spyOn(response, "clone").mockReturnValue({
      text: () => Promise.reject(new Error("body gone")),
    } as unknown as Response);
    const observed = createObservedFetch(makeFetch(response));

    await observed(SUPABASE_REST, {});

    expect(mockLogError).toHaveBeenCalledTimes(1);
  });
});
