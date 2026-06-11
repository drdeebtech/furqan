import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockCaptureException = vi.fn();

const mockCaptureMessage = vi.fn();
const mockAddBreadcrumb = vi.fn();
const mockSentryLoggerWarn = vi.fn();
const mockSentryLoggerInfo = vi.fn();

// Mutable logger object so tests can patch .warn/.info without re-mocking.
const sentryLoggerObj: { warn?: unknown; info?: unknown } = {};

vi.mock("@sentry/nextjs", () => ({
  captureException: (...args: unknown[]) => mockCaptureException(...args),
  get logger() { return sentryLoggerObj; },
  captureMessage: (...args: unknown[]) => mockCaptureMessage(...args),
  addBreadcrumb: (...args: unknown[]) => mockAddBreadcrumb(...args),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Snapshot and restore process.env around each test so env stubs don't leak.
let originalEnv: Record<string, string | undefined>;

beforeEach(() => {
  originalEnv = { ...process.env };
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});

afterEach(() => {
  // Restore env
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) {
      delete process.env[key];
    }
  }
  for (const [k, v] of Object.entries(originalEnv)) {
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
  vi.restoreAllMocks();
});

// ─── Import after mocks ───────────────────────────────────────────────────────

// Dynamic import so each test module load picks up the mocked modules.
// We import once at module level; the mock shapes are shared via the vi.fn() refs above.
import { logError, logWarn, logInfo } from "./logger";

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("logError — Sentry path (SENTRY_DSN set)", () => {
  beforeEach(() => {
    process.env.SENTRY_DSN = "https://abc@sentry.io/123";
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    delete process.env.TG_BOT_TOKEN;
    delete process.env.TG_ADMIN_CHAT_ID;
  });

  it("calls Sentry.captureException with the error", () => {
    const err = new Error("boom");
    logError("test message", err);

    expect(mockCaptureException).toHaveBeenCalledTimes(1);
    expect(mockCaptureException.mock.calls[0]![0]).toBe(err);
  });

  it("sets extra.message to the provided message string", () => {
    const err = new Error("db failure");
    logError("something broke", err);

    const sentryArg = mockCaptureException.mock.calls[0]![1] as {
      extra?: Record<string, unknown>;
    };
    expect(sentryArg.extra?.message).toBe("something broke");
  });

  it("promotes TAG_KEYS (tag, domain, route, kind, actionName, component, severity) to tags", () => {
    const err = new Error("oops");
    logError("ctx test", err, {
      tag: "payments",
      domain: "sessions",
      route: "/api/pay",
      kind: "mutation",
      actionName: "chargeStudent",
      component: "PayButton",
      severity: "warning",
    });

    const sentryArg = mockCaptureException.mock.calls[0]![1] as {
      tags?: Record<string, string>;
    };
    expect(sentryArg.tags).toEqual({
      tag: "payments",
      domain: "sessions",
      route: "/api/pay",
      kind: "mutation",
      actionName: "chargeStudent",
      component: "PayButton",
      severity: "warning",
    });
  });

  it("leaves non-TAG_KEYS keys in extras, not in tags", () => {
    const err = new Error("oops");
    logError("extras test", err, {
      tag: "audit",
      userId: "u-123",
      studentCount: 42,
    });

    const sentryArg = mockCaptureException.mock.calls[0]![1] as {
      extra?: Record<string, unknown>;
      tags?: Record<string, string>;
    };
    // TAG_KEY 'tag' is promoted
    expect(sentryArg.tags?.tag).toBe("audit");
    // Non-TAG_KEYS land in extras
    expect(sentryArg.extra?.userId).toBe("u-123");
    expect(sentryArg.extra?.studentCount).toBe(42);
    // They are NOT in tags
    expect(sentryArg.tags).not.toHaveProperty("userId");
    expect(sentryArg.tags).not.toHaveProperty("studentCount");
  });

  it("omits tags key entirely when context has no TAG_KEYS", () => {
    logError("no tags", new Error("x"), { requestId: "r-1" });

    const sentryArg = mockCaptureException.mock.calls[0]![1] as {
      tags?: unknown;
    };
    expect(sentryArg.tags).toBeUndefined();
  });

  it("omits extras key entirely when context has only TAG_KEYS", () => {
    logError("only tags", new Error("x"), { tag: "audit" });

    const sentryArg = mockCaptureException.mock.calls[0]![1] as {
      extra?: Record<string, unknown>;
    };
    // extra should only contain 'message', not any user context keys
    expect(Object.keys(sentryArg.extra ?? {})).toEqual(["message"]);
  });

  it("works when context is undefined", () => {
    const err = new Error("no ctx");
    expect(() => logError("bare call", err)).not.toThrow();
    expect(mockCaptureException).toHaveBeenCalledTimes(1);
  });

  it("does NOT call console.error when SENTRY_DSN is set", () => {
    logError("sentry path", new Error("x"));
    expect(console.error).not.toHaveBeenCalled();
  });
});

describe("logError — Sentry path via NEXT_PUBLIC_SENTRY_DSN", () => {
  beforeEach(() => {
    delete process.env.SENTRY_DSN;
    process.env.NEXT_PUBLIC_SENTRY_DSN = "https://pub@sentry.io/456";
    delete process.env.TG_BOT_TOKEN;
    delete process.env.TG_ADMIN_CHAT_ID;
  });

  it("routes to Sentry when only NEXT_PUBLIC_SENTRY_DSN is set", () => {
    logError("pub dsn test", new Error("x"));
    expect(mockCaptureException).toHaveBeenCalledTimes(1);
    expect(console.error).not.toHaveBeenCalled();
  });
});

describe("logError — console fallback (no SENTRY_DSN)", () => {
  beforeEach(() => {
    delete process.env.SENTRY_DSN;
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    delete process.env.TG_BOT_TOKEN;
    delete process.env.TG_ADMIN_CHAT_ID;
  });

  it("calls console.error with (message, error, context) when no DSN", () => {
    const err = new Error("console path");
    const ctx = { tag: "test" };
    logError("fallback msg", err, ctx);

    expect(console.error).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith("fallback msg", err, ctx);
  });

  it("does NOT call Sentry.captureException", () => {
    logError("no sentry", new Error("x"), { tag: "t" });
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it("passes undefined context through to console.error unchanged", () => {
    const err = new Error("bare");
    logError("no ctx", err);
    expect(console.error).toHaveBeenCalledWith("no ctx", err, undefined);
  });
});

describe("logError — Telegram critical alert", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Use NEXT_PUBLIC_SENTRY_DSN so Sentry path is active (Telegram check is
    // independent of the Sentry/console branch).
    process.env.NEXT_PUBLIC_SENTRY_DSN = "https://pub@sentry.io/456";
    process.env.TG_BOT_TOKEN = "bot-token-123";
    process.env.TG_ADMIN_CHAT_ID = "chat-987654";

    mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fires a Telegram fetch when severity=critical and TG env vars are set", async () => {
    logError("critical thing", new Error("db meltdown"), {
      tag: "payments",
      severity: "critical",
    });

    // fetch is called with void (fire-and-forget); allow microtasks to flush
    await new Promise((r) => setTimeout(r, 0));

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    // URL contains the bot token path
    expect(url).toContain("https://api.telegram.org/bot");
    expect(url).toContain("bot-token-123");
    // chat_id is sent in the POST body (not the URL)
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.chat_id).toBe("chat-987654");
  });

  it("includes TG_ADMIN_CHAT_ID in the POST body as chat_id", async () => {
    logError("crit 2", new Error("fatal"), { severity: "critical" });

    await new Promise((r) => setTimeout(r, 0));

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.chat_id).toBe(process.env.TG_ADMIN_CHAT_ID);
  });

  it("does NOT fire Telegram when severity is NOT 'critical'", async () => {
    logError("info level", new Error("minor"), {
      severity: "warning",
      tag: "audit",
    });

    await new Promise((r) => setTimeout(r, 0));

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("does NOT fire Telegram when severity is absent", async () => {
    logError("no severity", new Error("x"), { tag: "test" });

    await new Promise((r) => setTimeout(r, 0));

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("does NOT fire Telegram when TG_BOT_TOKEN is missing", async () => {
    delete process.env.TG_BOT_TOKEN;

    logError("no token", new Error("x"), { severity: "critical" });

    await new Promise((r) => setTimeout(r, 0));

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("does NOT fire Telegram when TG_ADMIN_CHAT_ID is missing", async () => {
    delete process.env.TG_ADMIN_CHAT_ID;

    logError("no chat id", new Error("x"), { severity: "critical" });

    await new Promise((r) => setTimeout(r, 0));

    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ─── logWarn ──────────────────────────────────────────────────────────────────

describe("logWarn — Sentry structured logger path", () => {
  afterEach(() => { delete sentryLoggerObj.warn; });

  it("calls sentryLogger.warn when available", () => {
    sentryLoggerObj.warn = mockSentryLoggerWarn;
    process.env.SENTRY_DSN = "https://abc@sentry.io/1";

    logWarn("structured warn", { domain: "sessions" });

    expect(mockSentryLoggerWarn).toHaveBeenCalledWith("structured warn", { domain: "sessions" });
    expect(console.warn).not.toHaveBeenCalled();
  });
});

describe("logWarn — Sentry captureMessage fallback (no structured logger)", () => {
  beforeEach(() => {
    process.env.SENTRY_DSN = "https://abc@sentry.io/1";
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
  });

  it("calls Sentry.captureMessage at warning level when DSN is set but logger.warn missing", () => {
    logWarn("fallback warn", { tag: "cron" });

    expect(mockCaptureMessage).toHaveBeenCalledTimes(1);
    const [msg, opts] = mockCaptureMessage.mock.calls[0] as [string, { level: string; extra?: unknown }];
    expect(msg).toBe("fallback warn");
    expect(opts.level).toBe("warning");
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("passes context as extra to captureMessage", () => {
    logWarn("with ctx", { domain: "booking" });

    const [, opts] = mockCaptureMessage.mock.calls[0] as [string, { extra?: Record<string, unknown> }];
    expect(opts.extra).toEqual({ domain: "booking" });
  });
});

describe("logWarn — console fallback (no DSN)", () => {
  beforeEach(() => {
    delete process.env.SENTRY_DSN;
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
  });

  it("calls console.warn when no DSN is configured", () => {
    logWarn("no dsn warn", { tag: "test" });

    expect(console.warn).toHaveBeenCalledWith("no dsn warn", { tag: "test" });
    expect(mockCaptureMessage).not.toHaveBeenCalled();
  });
});

// ─── logInfo ─────────────────────────────────────────────────────────────────

describe("logInfo — always adds Sentry breadcrumb", () => {
  it("adds a breadcrumb with category=log, level=info regardless of env", () => {
    logInfo("something happened", { domain: "sessions" });

    expect(mockAddBreadcrumb).toHaveBeenCalledTimes(1);
    const crumb = mockAddBreadcrumb.mock.calls[0]![0] as {
      category: string;
      level: string;
      message: string;
      data?: unknown;
    };
    expect(crumb.category).toBe("log");
    expect(crumb.level).toBe("info");
    expect(crumb.message).toBe("something happened");
    expect(crumb.data).toEqual({ domain: "sessions" });
  });
});

describe("logInfo — Sentry structured logger path", () => {
  afterEach(() => { delete sentryLoggerObj.info; });

  it("calls sentryLogger.info when available", () => {
    sentryLoggerObj.info = mockSentryLoggerInfo;

    logInfo("structured info", { tag: "cron" });

    expect(mockSentryLoggerInfo).toHaveBeenCalledWith("structured info", { tag: "cron" });
    expect(console.info).not.toHaveBeenCalled();
  });
});

describe("logInfo — console fallback outside production", () => {
  const origNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = origNodeEnv;
  });

  it("calls console.info in non-production when no structured logger", () => {
    process.env.NODE_ENV = "test";
    logInfo("dev info", { tag: "debug" });

    expect(console.info).toHaveBeenCalledWith("dev info", { tag: "debug" });
  });

  it("does NOT call console.info in production", () => {
    process.env.NODE_ENV = "production";
    logInfo("prod info", { tag: "cron" });

    expect(console.info).not.toHaveBeenCalled();
  });
});
