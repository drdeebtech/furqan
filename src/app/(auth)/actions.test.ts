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
const mockSignUp = vi.fn().mockResolvedValue({ data: { user: { id: "u-2" } }, error: null });
const mockProfileSingle = vi.fn().mockResolvedValue({ data: { role: "student" } });
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      signInWithPassword: mockSignInWithPassword,
      resetPasswordForEmail: mockResetPasswordForEmail,
      signUp: mockSignUp,
    },
    from: () => ({
      select: () => ({ eq: () => ({ single: mockProfileSingle }) }),
    }),
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

  it("login rejects missing credentials before touching any backend", async () => {
    const fd = new FormData();
    fd.set("email", "attacker@example.com");

    const result = await login({}, fd);

    expect(result).toEqual({ error: "البريد الإلكتروني وكلمة المرور مطلوبان" });
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockSignInWithPassword).not.toHaveBeenCalled();
  });

  it("login is denied when the cap is exceeded (limiter healthy)", async () => {
    mockRpc.mockResolvedValue({ data: false, error: null });

    const result = await login({}, loginForm());

    expect(result).toEqual({ error: RATE_LIMIT_ERROR });
    expect(mockSignInWithPassword).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid_credentials", "البريد الإلكتروني أو كلمة المرور غير صحيحة"],
    ["email_not_confirmed", "يرجى تأكيد بريدك الإلكتروني أولاً (تحقق من صندوق الوارد)"],
  ])("login maps the %s sign-in failure to its tailored message", async (code, message) => {
    mockRpc.mockResolvedValue({ data: true, error: null });
    mockSignInWithPassword.mockResolvedValueOnce({ data: { user: null }, error: { code } });

    const result = await login({}, loginForm());

    expect(result).toEqual({ error: message });
  });

  it("login surfaces a suspended-account message for banned users", async () => {
    mockRpc.mockResolvedValue({ data: true, error: null });
    mockSignInWithPassword.mockResolvedValueOnce({
      data: { user: null },
      error: { code: "user_banned" },
    });

    const result = await login({}, loginForm());

    expect(result.error).toContain("حسابك معلق");
  });

  it("forgotPassword requires an email", async () => {
    const result = await forgotPassword({}, new FormData());

    expect(result).toEqual({ error: "البريد الإلكتروني مطلوب" });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("forgotPassword sends the reset email and reports success when the limiter allows", async () => {
    mockRpc.mockResolvedValue({ data: true, error: null });

    const fd = new FormData();
    fd.set("email", "student@example.com");

    const result = await forgotPassword({}, fd);

    expect(result.success).toBeTruthy();
    expect(mockResetPasswordForEmail).toHaveBeenCalledWith(
      "student@example.com",
      expect.objectContaining({ redirectTo: expect.stringContaining("/login") }),
    );
  });

  it("register mirrors the success path for an already-registered email (no enumeration oracle)", async () => {
    mockRpc.mockResolvedValue({ data: true, error: null });
    mockSignUp.mockResolvedValueOnce({
      data: { user: null },
      error: { code: "user_already_exists" },
    });

    const fd = new FormData();
    fd.set("full_name", "Ali Student");
    fd.set("email", "existing@example.com");
    fd.set("password", "Sup3rSecret");
    fd.set("confirm_password", "Sup3rSecret");
    fd.set("consent", "yes");

    await expect(register({}, fd)).rejects.toThrow("NEXT_REDIRECT:/login?registered=true");
  });

  it.each([
    ["signup_disabled", "التسجيل متوقف مؤقتاً — تواصل معنا عبر واتساب"],
    ["weak_password", "كلمة المرور سهلة التخمين — اختر كلمة مرور أقوى"],
    ["over_email_send_rate_limit", "تم تجاوز المحاولات المسموحة — حاول خلال ساعة"],
    ["validation_failed", "تحقق من البريد الإلكتروني وأعد المحاولة"],
    ["something_unexpected", "حدث خطأ أثناء إنشاء الحساب"],
  ])("register maps the %s sign-up failure to its tailored message", async (code, message) => {
    mockRpc.mockResolvedValue({ data: true, error: null });
    mockSignUp.mockResolvedValueOnce({ data: { user: null }, error: { code } });

    const fd = new FormData();
    fd.set("full_name", "Ali Student");
    fd.set("email", "newuser@example.com");
    fd.set("password", "Sup3rSecret");
    fd.set("confirm_password", "Sup3rSecret");
    fd.set("consent", "yes");

    const result = await register({}, fd);

    expect(result).toEqual({ error: message });
  });

  it("login consults both the per-email and per-IP limiter layers when an IP is present", async () => {
    requestHeaders = { "x-forwarded-for": "203.0.113.9" };
    mockRpc.mockResolvedValue({ data: true, error: null });
    mockSignInWithPassword.mockResolvedValueOnce({
      data: { user: null },
      error: { code: "invalid_credentials" },
    });

    const result = await login({}, loginForm());

    expect(result).toEqual({ error: "البريد الإلكتروني أو كلمة المرور غير صحيحة" });
    const buckets = mockRpc.mock.calls.map((c) => (c[1] as { p_bucket: string }).p_bucket);
    expect(buckets).toEqual(["login-attempt", "login-attempt-ip"]);
  });

  it("login maps an unrecognized sign-in failure to the generic message", async () => {
    mockRpc.mockResolvedValue({ data: true, error: null });
    mockSignInWithPassword.mockResolvedValueOnce({
      data: { user: null },
      error: { code: "something_novel", status: 500 },
    });

    const result = await login({}, loginForm());

    expect(result).toEqual({ error: "حدث خطأ، حاول مرة أخرى" });
  });

  it("login with a @furqan.test account bypasses the rate limiter entirely (CI seam)", async () => {
    mockSignInWithPassword.mockResolvedValueOnce({
      data: { user: null },
      error: { code: "invalid_credentials" },
    });

    const result = await login({}, loginForm("ci-bot@furqan.test"));

    expect(result).toEqual({ error: "البريد الإلكتروني أو كلمة المرور غير صحيحة" });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("login success redirects to the role dashboard", async () => {
    mockRpc.mockResolvedValue({ data: true, error: null });
    mockProfileSingle.mockResolvedValueOnce({ data: { role: "teacher" } });

    await expect(login({}, loginForm())).rejects.toThrow("NEXT_REDIRECT:/teacher/dashboard");
  });

  it("login honors a safe relative redirect param", async () => {
    mockRpc.mockResolvedValue({ data: true, error: null });
    const fd = loginForm();
    fd.set("redirect", "/student/bookings");

    await expect(login({}, fd)).rejects.toThrow("NEXT_REDIRECT:/student/bookings");
  });

  it("login ignores an absolute/external redirect param (open-redirect guard)", async () => {
    mockRpc.mockResolvedValue({ data: true, error: null });
    const fd = loginForm();
    fd.set("redirect", "https://evil.example.com/phish");

    await expect(login({}, fd)).rejects.toThrow("NEXT_REDIRECT:/student/dashboard");
  });

  function registerForm(overrides: Record<string, string> = {}): FormData {
    const fd = new FormData();
    fd.set("full_name", "Ali Student");
    fd.set("email", "newuser@example.com");
    fd.set("password", "Sup3rSecret");
    fd.set("confirm_password", "Sup3rSecret");
    fd.set("consent", "yes");
    for (const [k, v] of Object.entries(overrides)) fd.set(k, v);
    return fd;
  }

  it("register without consent never creates an account (clickwrap enforcement)", async () => {
    mockRpc.mockResolvedValue({ data: true, error: null });
    const fd = registerForm();
    fd.delete("consent");

    const result = await register({}, fd);

    expect(result.error).toBeTruthy();
    expect(mockSignUp).not.toHaveBeenCalled();
  });

  it("register rejects a weak password", async () => {
    mockRpc.mockResolvedValue({ data: true, error: null });

    const result = await register({}, registerForm({ password: "aaaaaaaa", confirm_password: "aaaaaaaa" }));

    expect(result.error).toContain("كلمة المرور ضعيفة");
    expect(mockSignUp).not.toHaveBeenCalled();
  });

  it("register rejects mismatched passwords", async () => {
    mockRpc.mockResolvedValue({ data: true, error: null });

    const result = await register({}, registerForm({ confirm_password: "Different1" }));

    expect(result.error).toContain("غير متطابقتين");
    expect(mockSignUp).not.toHaveBeenCalled();
  });

  it("forgotPassword returns a generic error when the reset call fails", async () => {
    mockRpc.mockResolvedValue({ data: true, error: null });
    mockResetPasswordForEmail.mockResolvedValueOnce({ error: { status: 500, code: "smtp" } });

    const fd = new FormData();
    fd.set("email", "student@example.com");

    const result = await forgotPassword({}, fd);

    expect(result).toEqual({ error: "حدث خطأ، حاول مرة أخرى" });
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
