import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Top-level mocks for pure unit tests (WEBHOOK_ROUTES, serializePayload) ──
//
// emit.ts captures N8N_WEBHOOK_URL and N8N_WEBHOOK_SECRET as module-level
// constants at import time (lines 23-24 of emit.ts). vi.stubEnv() after import
// has no effect on those cached values.
//
// For emitEvent() behavioral tests we use loadEmit() which:
//   1. Sets env vars BEFORE import so the fresh module picks them up.
//   2. Re-registers all mocks via vi.doMock() after vi.resetModules().
//   3. Installs an after() mock that collects each async callback into
//      afterPromises[], then flush() awaits them all before assertions.
//
// This is needed because emitEvent calls `after(asyncFn)` fire-and-forget —
// the return value of after() is not awaited inside emitEvent itself, so
// simply awaiting emitEvent() does not wait for the webhook/DB work to finish.

vi.mock("next/server", () => ({
  after: vi.fn((fn: () => unknown) => { void fn(); }),
}));
vi.mock("@vercel/analytics/server", () => ({ track: vi.fn() }));
vi.mock("@/lib/settings", () => ({ getSettings: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));
vi.mock("@/lib/security/secrets", () => ({
  signWebhookPayload: vi.fn(() => ({
    timestamp: "1700000000",
    signature: "abc123signature",
  })),
}));

const mockInsert = vi.fn().mockResolvedValue({ error: null });
const mockFrom = vi.fn(() => ({ insert: mockInsert }));
const mockAdminClient = { from: mockFrom };
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => mockAdminClient),
}));

// ─── Static imports — used only for WEBHOOK_ROUTES and serializePayload ───────

import {
  WEBHOOK_ROUTES,
  DEFAULT_WEBHOOK_PATH,
  serializePayload,
  type FurqanEvent,
  type EventPayload,
} from "./emit";
import { getSettings } from "@/lib/settings";
import { logError } from "@/lib/logger";
import { signWebhookPayload } from "@/lib/security/secrets";

const mockGetSettings = vi.mocked(getSettings);
const mockLogError = vi.mocked(logError);
const mockSignWebhookPayload = vi.mocked(signWebhookPayload);

// ─── Settings helpers ─────────────────────────────────────────────────────────

function settingsEnabled(extra: Record<string, string> = {}): void {
  mockGetSettings.mockResolvedValue({ automation_enabled: "true", ...extra });
}
function settingsDisabled(): void {
  mockGetSettings.mockResolvedValue({ automation_enabled: "false" });
}

// ─── loadEmit + flush — core test infrastructure ──────────────────────────────

/** Promises from each after() callback; populated inside loadEmit(). */
let afterPromises: Promise<unknown>[];

/**
 * Re-import emit.ts with fresh env vars and fresh mocks. Returns the
 * emitEvent function from the freshly loaded module.
 *
 * IMPORTANT: after calling emitEvent(), always call `await flush()` before
 * asserting on side effects (fetch calls, DB inserts). emitEvent schedules
 * async work inside after() callbacks that are fire-and-forget relative to
 * the emitEvent return value.
 */
async function loadEmit(env: {
  N8N_WEBHOOK_URL?: string;
  N8N_WEBHOOK_SECRET?: string;
  NODE_ENV?: string;
}): Promise<typeof import("./emit")["emitEvent"]> {
  // Apply env vars before module load (they are captured as module-level consts).
  if (env.N8N_WEBHOOK_URL !== undefined)
    process.env.N8N_WEBHOOK_URL = env.N8N_WEBHOOK_URL;
  else delete process.env.N8N_WEBHOOK_URL;

  if (env.N8N_WEBHOOK_SECRET !== undefined)
    process.env.N8N_WEBHOOK_SECRET = env.N8N_WEBHOOK_SECRET;
  else delete process.env.N8N_WEBHOOK_SECRET;

  if (env.NODE_ENV !== undefined)
    (process.env as Record<string, string | undefined>)["NODE_ENV"] = env.NODE_ENV;

  vi.resetModules();

  // after() mock: record each callback as a microtask-scheduled Promise so
  // flush() can await all of them. Using Promise.resolve().then() lets the
  // async fn inside run to completion when awaited.
  const afterMock = vi.fn((fn: () => unknown) => {
    const p = Promise.resolve().then(() => fn());
    afterPromises.push(p);
  });

  vi.doMock("next/server", () => ({ after: afterMock }));
  vi.doMock("@vercel/analytics/server", () => ({ track: vi.fn() }));
  vi.doMock("@/lib/settings", () => ({ getSettings: mockGetSettings }));
  vi.doMock("@/lib/logger", () => ({ logError: mockLogError }));
  vi.doMock("@/lib/security/secrets", () => ({
    signWebhookPayload: mockSignWebhookPayload,
  }));
  // Dynamic import("@/lib/supabase/admin") inside recordOutcome() must also
  // resolve to the test double, not the real Supabase client (which imports
  // server-only and would throw in node env).
  vi.doMock("@/lib/supabase/admin", () => ({
    createAdminClient: vi.fn(() => mockAdminClient),
  }));

  const mod = await import("./emit");
  return mod.emitEvent;
}

/**
 * Await all after() callbacks queued during the current test.
 * Call this after every emitEvent() invocation before asserting side effects.
 */
async function flush(): Promise<void> {
  await Promise.allSettled(afterPromises);
  // Second pass catches any microtasks enqueued by the first round.
  await Promise.allSettled(afterPromises);
}

// ─── Fixed payload for serializePayload tests ─────────────────────────────────

const FIXED_PAYLOAD: EventPayload = {
  event: "booking.confirmed",
  occurred_at: "2026-04-28T05:00:00.000Z",
  entity_type: "booking",
  entity_id: "11111111-2222-3333-4444-555555555555",
  actor_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  trace_id: "ffffffff-0000-1111-2222-333333333333",
  source: "furqan-app",
  data: { student_id: "s-1", teacher_id: "t-1", session_count: 4 },
};

// ─── Global test setup ────────────────────────────────────────────────────────

let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  afterPromises = [];
  mockInsert.mockResolvedValue({ error: null });

  mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.doUnmock("next/server");
  vi.doUnmock("@vercel/analytics/server");
  vi.doUnmock("@/lib/settings");
  vi.doUnmock("@/lib/logger");
  vi.doUnmock("@/lib/security/secrets");
  vi.doUnmock("@/lib/supabase/admin");
});

// ─── WEBHOOK_ROUTES structure ─────────────────────────────────────────────────

describe("WEBHOOK_ROUTES", () => {
  it("contains expected event keys", () => {
    const keys = Object.keys(WEBHOOK_ROUTES) as FurqanEvent[];
    expect(keys).toContain("booking.confirmed");
    expect(keys).toContain("booking.created");
    expect(keys).toContain("booking.cancelled");
    expect(keys).toContain("session.ended");
    expect(keys).toContain("session.no_show");
    expect(keys).toContain("teacher.applied");
    expect(keys).toContain("homework.graded");
    expect(keys).toContain("lesson.completed");
    expect(keys).toContain("package.purchased");
    expect(keys).toContain("profile.created");
  });

  it("has at least 30 registered event routes", () => {
    expect(Object.keys(WEBHOOK_ROUTES).length).toBeGreaterThanOrEqual(30);
  });

  it("has all values starting with '/webhook/'", () => {
    for (const [event, path] of Object.entries(WEBHOOK_ROUTES)) {
      expect(path, `${event} path should start with /webhook/`).toMatch(
        /^\/webhook\//,
      );
    }
  });

  it("maps booking.confirmed to the dedicated route", () => {
    expect(WEBHOOK_ROUTES["booking.confirmed"]).toBe(
      "/webhook/furqan-booking-confirmed",
    );
  });

  it("maps session.ended to the dedicated route", () => {
    expect(WEBHOOK_ROUTES["session.ended"]).toBe("/webhook/furqan-session-ended");
  });

  it("maps teacher.applied to the dedicated route", () => {
    expect(WEBHOOK_ROUTES["teacher.applied"]).toBe("/webhook/furqan-teacher-applied");
  });

  it("every value is a non-empty string", () => {
    for (const [event, path] of Object.entries(WEBHOOK_ROUTES)) {
      expect(typeof path, `path for ${event}`).toBe("string");
      expect(path.length, `path for ${event} is empty`).toBeGreaterThan(0);
    }
  });
});

// ─── DEFAULT_WEBHOOK_PATH ─────────────────────────────────────────────────────

describe("DEFAULT_WEBHOOK_PATH", () => {
  it("equals '/webhook/furqan-events'", () => {
    expect(DEFAULT_WEBHOOK_PATH).toBe("/webhook/furqan-events");
  });
});

// ─── serializePayload ─────────────────────────────────────────────────────────

describe("serializePayload", () => {
  it("produces identical bytes for the same logical payload across calls (deterministic)", () => {
    expect(serializePayload(FIXED_PAYLOAD)).toBe(serializePayload(FIXED_PAYLOAD));
  });

  it("sorts data keys alphabetically (so insertion order doesn't matter)", () => {
    const reordered: EventPayload = {
      ...FIXED_PAYLOAD,
      data: { teacher_id: "t-1", session_count: 4, student_id: "s-1" },
    };
    expect(serializePayload(reordered)).toBe(serializePayload(FIXED_PAYLOAD));
  });

  it("emits top-level fields in the pinned order (event first, data last)", () => {
    const json = serializePayload(FIXED_PAYLOAD);
    const eventIdx = json.indexOf('"event"');
    const dataIdx = json.indexOf('"data"');
    expect(eventIdx).toBeGreaterThanOrEqual(0);
    expect(dataIdx).toBeGreaterThan(eventIdx);
  });

  it("top-level field order matches canonical contract exactly", () => {
    const parsed = JSON.parse(serializePayload(FIXED_PAYLOAD)) as object;
    expect(Object.keys(parsed)).toEqual([
      "event",
      "occurred_at",
      "entity_type",
      "entity_id",
      "actor_id",
      "trace_id",
      "source",
      "data",
    ]);
  });

  it("returns a JSON string containing all EventPayload fields", () => {
    const result = serializePayload(FIXED_PAYLOAD);
    const parsed = JSON.parse(result) as Record<string, unknown>;

    expect(parsed.event).toBe("booking.confirmed");
    expect(parsed.occurred_at).toBe("2026-04-28T05:00:00.000Z");
    expect(parsed.entity_type).toBe("booking");
    expect(parsed.entity_id).toBe("11111111-2222-3333-4444-555555555555");
    expect(parsed.actor_id).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(parsed.trace_id).toBe("ffffffff-0000-1111-2222-333333333333");
    expect(parsed.source).toBe("furqan-app");
    expect(parsed.data).toEqual({
      session_count: 4,
      student_id: "s-1",
      teacher_id: "t-1",
    });
  });

  it("emits compact JSON without extra whitespace", () => {
    const result = serializePayload(FIXED_PAYLOAD);
    expect(result).not.toMatch(/\n/);
    expect(result).not.toMatch(/": /); // no space after colon
  });

  it("changes output when a data value changes", () => {
    const tweaked: EventPayload = {
      ...FIXED_PAYLOAD,
      data: { ...FIXED_PAYLOAD.data, session_count: 5 },
    };
    expect(serializePayload(tweaked)).not.toBe(serializePayload(FIXED_PAYLOAD));
  });

  it("handles empty data object", () => {
    const empty: EventPayload = { ...FIXED_PAYLOAD, data: {} };
    const out = serializePayload(empty);
    expect(out).toContain('"data":{}');
  });

  it("handles null actor_id", () => {
    const payload: EventPayload = { ...FIXED_PAYLOAD, actor_id: null };
    const parsed = JSON.parse(serializePayload(payload)) as Record<string, unknown>;
    expect(parsed.actor_id).toBeNull();
  });

  it("preserves nested objects without reordering them (top-level data sort only)", () => {
    // Contract: only immediate `data` keys are sorted; nested objects keep
    // insertion order. If a future change sorts recursively, the n8n verifier
    // must mirror it — hence this pinned assertion.
    const nested: EventPayload = {
      ...FIXED_PAYLOAD,
      data: { meta: { z: 1, a: 2 } },
    };
    const out = serializePayload(nested);
    expect(out).toContain('"meta":{"z":1,"a":2}');
  });
});

// ─── emitEvent — URL unset in non-production ─────────────────────────────────
// emit.ts caches N8N_WEBHOOK_URL at module load time, so we use loadEmit()
// to re-import the module with the desired env vars pre-set.

describe("emitEvent — N8N_WEBHOOK_URL unset in non-production (dev/test)", () => {
  it("does not call fetch when N8N_WEBHOOK_URL is empty", async () => {
    const emitEvent = await loadEmit({ N8N_WEBHOOK_URL: "", NODE_ENV: "development" });

    await emitEvent("booking.confirmed", "booking", "bk-001", { student_id: "s-1" });
    await flush();

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("does not call logError in non-production when URL is unset", async () => {
    const emitEvent = await loadEmit({ N8N_WEBHOOK_URL: "", NODE_ENV: "development" });

    await emitEvent("session.ended", "session", "sess-01", {});
    await flush();

    expect(mockLogError).not.toHaveBeenCalled();
  });

  it("does not write to automation_logs in non-production when URL is unset", async () => {
    const emitEvent = await loadEmit({ N8N_WEBHOOK_URL: "", NODE_ENV: "test" });

    await emitEvent("homework.assigned", "homework", "hw-01", {});
    await flush();

    expect(mockFrom).not.toHaveBeenCalled();
  });
});

// ─── emitEvent — URL unset in production ─────────────────────────────────────

describe("emitEvent — N8N_WEBHOOK_URL unset in production", () => {
  it("calls logError with 'N8N_WEBHOOK_URL not configured' message", async () => {
    const emitEvent = await loadEmit({ N8N_WEBHOOK_URL: "", NODE_ENV: "production" });

    await emitEvent("booking.confirmed", "booking", "bk-001", {});
    await flush();

    expect(mockLogError).toHaveBeenCalledTimes(1);
    const [message] = mockLogError.mock.calls[0] as [string, Error, unknown];
    expect(message).toMatch(/N8N_WEBHOOK_URL not configured/i);
  });

  it("passes an Error instance to logError", async () => {
    const emitEvent = await loadEmit({ N8N_WEBHOOK_URL: "", NODE_ENV: "production" });

    await emitEvent("booking.confirmed", "booking", "bk-001", {});
    await flush();

    const [, err] = mockLogError.mock.calls[0] as [string, Error, unknown];
    expect(err).toBeInstanceOf(Error);
  });

  it("inserts a 'skipped' automation_log with reason 'n8n_webhook_url unset'", async () => {
    const emitEvent = await loadEmit({ N8N_WEBHOOK_URL: "", NODE_ENV: "production" });

    await emitEvent("booking.confirmed", "booking", "bk-001", {});
    await flush();

    expect(mockFrom).toHaveBeenCalledWith("automation_logs");
    expect(mockInsert).toHaveBeenCalledTimes(1);
    const insertArg = mockInsert.mock.calls[0]![0] as Record<string, unknown>;
    expect(insertArg.status).toBe("skipped");
    expect(insertArg.event_name).toBe("booking.confirmed");
    expect(String(insertArg.error_message)).toMatch(/n8n_webhook_url unset/i);
  });

  it("does not call fetch", async () => {
    const emitEvent = await loadEmit({ N8N_WEBHOOK_URL: "", NODE_ENV: "production" });

    await emitEvent("session.ended", "session", "sess-01", {});
    await flush();

    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ─── emitEvent — automation_enabled=false ────────────────────────────────────

describe("emitEvent — automation_enabled=false (kill-switch)", () => {
  it("does not call fetch", async () => {
    settingsDisabled();
    const emitEvent = await loadEmit({ N8N_WEBHOOK_URL: "https://n8n.example.com" });

    await emitEvent("booking.confirmed", "booking", "bk-001", {});
    await flush();

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("inserts a 'skipped' record with automation_enabled=false reason", async () => {
    settingsDisabled();
    const emitEvent = await loadEmit({ N8N_WEBHOOK_URL: "https://n8n.example.com" });

    await emitEvent("session.ended", "session", "sess-01", {});
    await flush();

    expect(mockFrom).toHaveBeenCalledWith("automation_logs");
    expect(mockInsert).toHaveBeenCalledTimes(1);
    const insertArg = mockInsert.mock.calls[0]![0] as Record<string, unknown>;
    expect(insertArg.status).toBe("skipped");
    expect(insertArg.event_name).toBe("session.ended");
    expect(String(insertArg.error_message)).toMatch(/automation_enabled=false/i);
  });
});

// ─── emitEvent — successful delivery ─────────────────────────────────────────

describe("emitEvent — successful delivery (automation_enabled=true)", () => {
  it("calls fetch with the correct full URL for a known event", async () => {
    settingsEnabled();
    const emitEvent = await loadEmit({ N8N_WEBHOOK_URL: "https://n8n.example.com" });

    await emitEvent("booking.confirmed", "booking", "bk-001", {});
    await flush();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://n8n.example.com/webhook/furqan-booking-confirmed");
  });

  it("sends POST with Content-Type: application/json header", async () => {
    settingsEnabled();
    const emitEvent = await loadEmit({ N8N_WEBHOOK_URL: "https://n8n.example.com" });

    await emitEvent("session.ended", "session", "sess-01", {});
    await flush();

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json",
    );
  });

  it("sets X-Furqan-Event header to the event name", async () => {
    settingsEnabled();
    const emitEvent = await loadEmit({ N8N_WEBHOOK_URL: "https://n8n.example.com" });

    await emitEvent("teacher.applied", "teacher", "t-001", {});
    await flush();

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["X-Furqan-Event"]).toBe(
      "teacher.applied",
    );
  });

  it("sends JSON body containing event, entity_type, entity_id and source", async () => {
    settingsEnabled();
    const emitEvent = await loadEmit({ N8N_WEBHOOK_URL: "https://n8n.example.com" });

    await emitEvent("homework.assigned", "homework", "hw-01", { student_id: "s-1" });
    await flush();

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.event).toBe("homework.assigned");
    expect(body.entity_type).toBe("homework");
    expect(body.entity_id).toBe("hw-01");
    expect(body.source).toBe("furqan-app");
  });

  it("allows actorId=null without throwing", async () => {
    settingsEnabled();
    const emitEvent = await loadEmit({ N8N_WEBHOOK_URL: "https://n8n.example.com" });

    await expect(
      emitEvent("booking.confirmed", "booking", "bk-002", {}, null),
    ).resolves.toBeUndefined();
    await flush();

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.actor_id).toBeNull();
  });

  it("does not write to automation_logs on successful delivery", async () => {
    settingsEnabled();
    const emitEvent = await loadEmit({ N8N_WEBHOOK_URL: "https://n8n.example.com" });

    await emitEvent("booking.confirmed", "booking", "bk-001", {});
    await flush();

    expect(mockFrom).not.toHaveBeenCalled();
  });
});

// ─── emitEvent — HMAC signing ────────────────────────────────────────────────

describe("emitEvent — HMAC signing (N8N_WEBHOOK_SECRET set)", () => {
  it("adds X-Furqan-Timestamp and X-Furqan-Signature headers", async () => {
    settingsEnabled();
    const emitEvent = await loadEmit({
      N8N_WEBHOOK_URL: "https://n8n.example.com",
      N8N_WEBHOOK_SECRET: "my-secret",
    });

    await emitEvent("booking.confirmed", "booking", "bk-001", {});
    await flush();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Furqan-Timestamp"]).toBe("1700000000");
    expect(headers["X-Furqan-Signature"]).toBe("abc123signature");
  });

  it("passes the serialized body and the secret to signWebhookPayload", async () => {
    settingsEnabled();
    const emitEvent = await loadEmit({
      N8N_WEBHOOK_URL: "https://n8n.example.com",
      N8N_WEBHOOK_SECRET: "my-secret",
    });

    await emitEvent("session.ended", "session", "sess-01", {});
    await flush();

    expect(mockSignWebhookPayload).toHaveBeenCalledTimes(1);
    const [rawBody, secret] = mockSignWebhookPayload.mock.calls[0] as [string, string];
    expect(typeof rawBody).toBe("string");
    expect((JSON.parse(rawBody) as Record<string, unknown>).event).toBe("session.ended");
    expect(secret).toBe("my-secret");
  });

  it("does NOT add signing headers when N8N_WEBHOOK_SECRET is absent", async () => {
    settingsEnabled();
    const emitEvent = await loadEmit({
      N8N_WEBHOOK_URL: "https://n8n.example.com",
      N8N_WEBHOOK_SECRET: "",
    });

    await emitEvent("booking.confirmed", "booking", "bk-001", {});
    await flush();

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Furqan-Timestamp"]).toBeUndefined();
    expect(headers["X-Furqan-Signature"]).toBeUndefined();
  });

  it("does NOT call signWebhookPayload when N8N_WEBHOOK_SECRET is absent", async () => {
    settingsEnabled();
    const emitEvent = await loadEmit({
      N8N_WEBHOOK_URL: "https://n8n.example.com",
      N8N_WEBHOOK_SECRET: "",
    });

    await emitEvent("booking.confirmed", "booking", "bk-001", {});
    await flush();

    expect(mockSignWebhookPayload).not.toHaveBeenCalled();
  });
});

// ─── emitEvent — fetch failure handling ──────────────────────────────────────

describe("emitEvent — fetch failure handling", () => {
  it("inserts a 'failed' automation_log when fetch returns non-ok status (503)", async () => {
    settingsEnabled();
    const emitEvent = await loadEmit({ N8N_WEBHOOK_URL: "https://n8n.example.com" });
    mockFetch.mockResolvedValue({ ok: false, status: 503 });

    await emitEvent("booking.confirmed", "booking", "bk-001", {});
    await flush();

    expect(mockFrom).toHaveBeenCalledWith("automation_logs");
    const insertArg = mockInsert.mock.calls[0]![0] as Record<string, unknown>;
    expect(insertArg.status).toBe("failed");
    expect(insertArg.event_name).toBe("booking.confirmed");
    expect(String(insertArg.error_message)).toMatch(/n8n 503/i);
  });

  it("inserts a 'failed' automation_log when fetch rejects with a network error", async () => {
    settingsEnabled();
    const emitEvent = await loadEmit({ N8N_WEBHOOK_URL: "https://n8n.example.com" });
    mockFetch.mockRejectedValue(new Error("network timeout"));

    await emitEvent("session.ended", "session", "sess-01", {});
    await flush();

    expect(mockFrom).toHaveBeenCalledWith("automation_logs");
    const insertArg = mockInsert.mock.calls[0]![0] as Record<string, unknown>;
    expect(insertArg.status).toBe("failed");
    expect(String(insertArg.error_message)).toMatch(/network timeout/i);
  });

  it("includes workflow_name 'furqan-app:emitEvent' in failure record", async () => {
    settingsEnabled();
    const emitEvent = await loadEmit({ N8N_WEBHOOK_URL: "https://n8n.example.com" });
    mockFetch.mockResolvedValue({ ok: false, status: 502 });

    await emitEvent("teacher.applied", "teacher", "t-001", {});
    await flush();

    const insertArg = mockInsert.mock.calls[0]![0] as Record<string, unknown>;
    expect(insertArg.workflow_name).toBe("furqan-app:emitEvent");
  });
});

// ─── emitEvent — per-event sub-flags ─────────────────────────────────────────

describe("emitEvent — per-event sub-flags", () => {
  it("skips homework.graded when ai_parent_reports_enabled=false", async () => {
    settingsEnabled({ ai_parent_reports_enabled: "false" });
    const emitEvent = await loadEmit({ N8N_WEBHOOK_URL: "https://n8n.example.com" });

    await emitEvent("homework.graded", "homework", "hw-01", {});
    await flush();

    expect(mockFetch).not.toHaveBeenCalled();
    const insertArg = mockInsert.mock.calls[0]![0] as Record<string, unknown>;
    expect(insertArg.status).toBe("skipped");
    expect(String(insertArg.error_message)).toMatch(/ai_parent_reports_enabled=false/i);
  });

  it("delivers homework.graded when ai_parent_reports_enabled=true", async () => {
    settingsEnabled({ ai_parent_reports_enabled: "true" });
    const emitEvent = await loadEmit({ N8N_WEBHOOK_URL: "https://n8n.example.com" });

    await emitEvent("homework.graded", "homework", "hw-01", {});
    await flush();

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("skips session.notes_saved when ai_parent_reports_enabled=false", async () => {
    settingsEnabled({ ai_parent_reports_enabled: "false" });
    const emitEvent = await loadEmit({ N8N_WEBHOOK_URL: "https://n8n.example.com" });

    await emitEvent("session.notes_saved", "session", "sess-01", {});
    await flush();

    expect(mockFetch).not.toHaveBeenCalled();
    const insertArg = mockInsert.mock.calls[0]![0] as Record<string, unknown>;
    expect(insertArg.status).toBe("skipped");
  });

  it("skips session.no_show when ai_parent_reports_enabled=false", async () => {
    settingsEnabled({ ai_parent_reports_enabled: "false" });
    const emitEvent = await loadEmit({ N8N_WEBHOOK_URL: "https://n8n.example.com" });

    await emitEvent("session.no_show", "session", "sess-01", {});
    await flush();

    expect(mockFetch).not.toHaveBeenCalled();
    const insertArg = mockInsert.mock.calls[0]![0] as Record<string, unknown>;
    expect(insertArg.status).toBe("skipped");
  });

  it("skips retention.intervention_triggered when retention_automation_enabled=false", async () => {
    settingsEnabled({ retention_automation_enabled: "false" });
    const emitEvent = await loadEmit({ N8N_WEBHOOK_URL: "https://n8n.example.com" });

    await emitEvent("retention.intervention_triggered", "student", "s-001", {});
    await flush();

    expect(mockFetch).not.toHaveBeenCalled();
    const insertArg = mockInsert.mock.calls[0]![0] as Record<string, unknown>;
    expect(insertArg.status).toBe("skipped");
    expect(String(insertArg.error_message)).toMatch(/retention_automation_enabled=false/i);
  });

  it("delivers booking.confirmed regardless of ai_parent_reports_enabled (no sub-flag)", async () => {
    settingsEnabled({ ai_parent_reports_enabled: "false" });
    const emitEvent = await loadEmit({ N8N_WEBHOOK_URL: "https://n8n.example.com" });

    await emitEvent("booking.confirmed", "booking", "bk-001", {});
    await flush();

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

// ─── emitEvent — automation_log record shape ─────────────────────────────────

describe("emitEvent — automation_log record shape", () => {
  it("skipped record includes workflow_name, idempotency_key (UUID), and finished_at", async () => {
    settingsDisabled();
    const emitEvent = await loadEmit({ N8N_WEBHOOK_URL: "https://n8n.example.com" });

    await emitEvent("teacher.applied", "teacher", "t-001", {});
    await flush();

    const insertArg = mockInsert.mock.calls[0]![0] as Record<string, unknown>;
    expect(insertArg.workflow_name).toBe("furqan-app:emitEvent");
    expect(typeof insertArg.idempotency_key).toBe("string");
    expect((insertArg.idempotency_key as string).length).toBeGreaterThan(0);
    expect(typeof insertArg.finished_at).toBe("string");
  });

  it("skipped record includes entity_type and entity_id", async () => {
    settingsDisabled();
    const emitEvent = await loadEmit({ N8N_WEBHOOK_URL: "https://n8n.example.com" });

    await emitEvent("lesson.completed", "lesson", "lesson-99", {});
    await flush();

    const insertArg = mockInsert.mock.calls[0]![0] as Record<string, unknown>;
    expect(insertArg.entity_type).toBe("lesson");
    expect(insertArg.entity_id).toBe("lesson-99");
  });
});

// ─── Type-safety documentation ───────────────────────────────────────────────
//
// TypeScript compile-time guarantee: emitEvent's first parameter is typed as
// FurqanEvent (keyof typeof WEBHOOK_ROUTES). Passing an unregistered string
// such as emitEvent("booking.unknown", ...) is a compile error:
//
//   Argument of type '"booking.unknown"' is not assignable to parameter of
//   type 'FurqanEvent'.
//
// This is enforced entirely by the type system; no runtime check is needed.
// The test below documents this contract and confirms the union is non-empty.
describe("FurqanEvent — type-safety contract (compile-time)", () => {
  it("WEBHOOK_ROUTES is non-empty and all keys are valid FurqanEvent members", () => {
    const keys: FurqanEvent[] = Object.keys(WEBHOOK_ROUTES) as FurqanEvent[];
    expect(keys.length).toBeGreaterThan(0);
  });
});
