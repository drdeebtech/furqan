import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockCreateSupabaseClient = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
  createClient: (...args: unknown[]) => mockCreateSupabaseClient(...args),
}));

// The observability wrapper imports logError; stub the whole module so the
// admin client tests don't depend on Sentry being configured.
vi.mock("@/lib/logger", () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
  logInfo: vi.fn(),
}));

// `server-only` throws in non-server environments — no-op for test runner.
vi.mock("server-only", () => ({}));

// ─── Env helpers ─────────────────────────────────────────────────────────────

let originalEnv: Record<string, string | undefined>;

beforeEach(() => {
  originalEnv = { ...process.env };
  vi.clearAllMocks();
  // Default: both env vars present; bypass the prod-URL guard so happy-path
  // and missing-env tests can use a real-looking remote URL without triggering
  // the "no writes to remote in test mode" protection.
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-secret";
  process.env.SUPABASE_ALLOW_PROD_IN_TESTS = "true";
});

afterEach(() => {
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
});

// ─── Import after mocks ───────────────────────────────────────────────────────

import { createAdminClient } from "./admin";

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("createAdminClient — missing env vars", () => {
  it("throws when SUPABASE_SERVICE_ROLE_KEY is absent", () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    expect(() => createAdminClient()).toThrow(
      "Missing SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL",
    );
  });

  it("throws when NEXT_PUBLIC_SUPABASE_URL is absent", () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;

    expect(() => createAdminClient()).toThrow(
      "Missing SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL",
    );
  });

  it("throws when both env vars are absent", () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    expect(() => createAdminClient()).toThrow(
      "Missing SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL",
    );
  });

  it("throws an Error instance (not a plain string)", () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    expect(() => createAdminClient()).toThrowError(Error);
  });
});

describe("createAdminClient — happy path", () => {
  beforeEach(() => {
    // Return a dummy client object so callers can assert on it
    mockCreateSupabaseClient.mockReturnValue({ from: vi.fn() });
  });

  it("calls createClient with (url, serviceKey)", () => {
    createAdminClient();

    expect(mockCreateSupabaseClient).toHaveBeenCalledTimes(1);
    const [url, key] = mockCreateSupabaseClient.mock.calls[0] as [string, string, unknown];
    expect(url).toBe("https://project.supabase.co");
    expect(key).toBe("service-role-secret");
  });

  it("passes auth config with autoRefreshToken: false", () => {
    createAdminClient();

    const [, , options] = mockCreateSupabaseClient.mock.calls[0] as [
      string,
      string,
      { auth?: { autoRefreshToken?: boolean; persistSession?: boolean } },
    ];
    expect(options.auth?.autoRefreshToken).toBe(false);
  });

  it("passes auth config with persistSession: false", () => {
    createAdminClient();

    const [, , options] = mockCreateSupabaseClient.mock.calls[0] as [
      string,
      string,
      { auth?: { autoRefreshToken?: boolean; persistSession?: boolean } },
    ];
    expect(options.auth?.persistSession).toBe(false);
  });

  it("returns a truthy client object", () => {
    const client = createAdminClient();
    expect(client).toBeTruthy();
  });

  it("passes a global.fetch override (observedFetch) in options", () => {
    createAdminClient();

    const [, , options] = mockCreateSupabaseClient.mock.calls[0] as [
      string,
      string,
      { global?: { fetch?: unknown } },
    ];
    expect(typeof options.global?.fetch).toBe("function");
  });
});

describe("createAdminClient — prod-URL guard", () => {
  beforeEach(() => {
    // Use a remote-looking URL; override the bypass set in global beforeEach
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abcdefghijklmnop.supabase.co";
    delete process.env.SUPABASE_ALLOW_PROD_IN_TESTS;
    mockCreateSupabaseClient.mockReturnValue({ from: vi.fn() });
  });

  it("throws when NODE_ENV=test and URL is remote", () => {
    expect(() => createAdminClient()).toThrow(
      "[furqan] createAdminClient() blocked: remote Supabase URL in test mode.",
    );
  });

  it("error message names all three fix options", () => {
    expect(() => createAdminClient()).toThrow("Fix options (pick one):");
  });

  it("does NOT throw when URL is localhost (local stack)", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
    expect(() => createAdminClient()).not.toThrow();
  });

  it("does NOT throw when URL is 127.0.0.1 (local stack alternate)", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    expect(() => createAdminClient()).not.toThrow();
  });

  it("does NOT throw when URL is ::1 (IPv6 local stack)", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://[::1]:54321";
    expect(() => createAdminClient()).not.toThrow();
  });

  it("does NOT throw when SUPABASE_ALLOW_PROD_IN_TESTS=true bypasses the guard", () => {
    process.env.SUPABASE_ALLOW_PROD_IN_TESTS = "true";
    expect(() => createAdminClient()).not.toThrow();
  });

  it('still throws when SUPABASE_ALLOW_PROD_IN_TESTS="false" (only "true" bypasses)', () => {
    process.env.SUPABASE_ALLOW_PROD_IN_TESTS = "false";
    expect(() => createAdminClient()).toThrow(
      "[furqan] createAdminClient() blocked: remote Supabase URL in test mode.",
    );
  });
});
