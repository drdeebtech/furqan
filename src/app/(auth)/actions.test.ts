/**
 * Behavior tests for the auth server actions' fail-closed rate limiting
 * (issue #688 acceptance: limiter DB error on login/register/forgot-password
 * → request DENIED, not allowed).
 *
 * Mocks sit at system boundaries only (Supabase clients, Sentry/logger sinks,
 * Next.js framework modules). The internal chain — action → checkAuthRate →
 * checkRateLimit → RPC — runs for real, so these tests survive refactors of
 * that chain as long as the observable behavior (the returned AuthResult)
 * holds.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRpc = vi.fn();
const mockInsert = vi.fn();
// Per-test request headers (e.g. x-forwarded-for for the per-IP limiter).
let requestHeaders: Record<string, string> = {};

vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: mockRpc,
    from: () => ({ insert: mockInsert }),
  }),
}));

// Must never be reached when the limiter denies: a successful sign-in here
// would change the returned AuthResult and fail the assertion.
const mockSignInWithPassword = vi.fn().mockResolvedValue({
  data: { user: { id: "u-1" } },
  error: null,
});
const mockResetPasswordForEmail = vi.fn().mockResolvedValue({ error: null });
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      signInWithPassword: mockSignInWithPassword,
      resetPasswordForEmail: mockResetPasswordForEmail,
    },
  }),
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(requestHeaders),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

vi.mock("botid/server", () => ({
  checkBotId: vi.fn().mockResolvedValue({ isBot: false, isHuman: true }),
}));

vi.mock("@sentry/nextjs", () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logError: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
}));

vi.mock("@/lib/posthog-server", () => ({
  getPostHogClient: () => null,
}));

import { forgotPassword, login, register } from "./actions";

const RATE_LIMIT_ERROR = "تم تجاوز المحاولات المسموحة — حاول خلال ساعة";

function loginForm(email = "attacker@example.com"): FormData {
  const fd = new FormData();
  fd.set("email", email);
  fd.set("password", "Sup3rSecret");
  return fd;
}

describe("auth actions fail closed when the rate-limiter backend errors (#688)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requestHeaders = {};
    mockInsert.mockResolvedValue({ error: null });
  });

  it("login is denied, and never reaches password sign-in", async () => {
    mockRpc.mockRejectedValue(new Error("limiter db down"));

    const result = await login({}, loginForm());

    expect(result).toEqual({ error: RATE_LIMIT_ERROR });
    expect(mockSignInWithPassword).not.toHaveBeenCalled();
  });

  it("login is denied when only the per-IP limiter backend errors (per-email healthy)", async () => {
    requestHeaders = { "x-forwarded-for": "203.0.113.7" };
    mockRpc.mockImplementation(async (_fn: string, args: { p_bucket: string }) => {
      if (args.p_bucket === "login-attempt-ip") throw new Error("limiter db down");
      return { data: true, error: null };
    });

    const result = await login({}, loginForm());

    expect(result).toEqual({ error: RATE_LIMIT_ERROR });
    expect(mockSignInWithPassword).not.toHaveBeenCalled();
  });
  it("forgotPassword is denied, and never sends a reset email", async () => {
    mockRpc.mockRejectedValue(new Error("limiter db down"));

    const fd = new FormData();
    fd.set("email", "attacker@example.com");

    const result = await forgotPassword({}, fd);

    expect(result).toEqual({ error: RATE_LIMIT_ERROR });
    expect(mockResetPasswordForEmail).not.toHaveBeenCalled();
  });
  it("register is denied before validation or sign-up", async () => {
    mockRpc.mockRejectedValue(new Error("limiter db down"));

    const fd = new FormData();
    fd.set("email", "attacker@example.com");

    const result = await register({}, fd);

    expect(result).toEqual({ error: RATE_LIMIT_ERROR });
  });
});
