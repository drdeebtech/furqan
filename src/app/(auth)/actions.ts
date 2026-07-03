"use server";

import { createHash } from "node:crypto";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { checkBotId } from "botid/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logError, logInfo } from "@/lib/logger";
import { withTimeout } from "@/lib/promise-utils";
import { isSafeRelativePath } from "@/lib/security/safe-url";
import { getPostHogClient } from "@/lib/posthog-server";
import { CONTACT } from "@/lib/contact";
import { buildConsentRecord } from "@/lib/legal";
import { registerSchema, registerErrorMessage } from "@/lib/auth/register-schema";

/**
 * Deterministically hash an email to a UUID-shaped key so it fits the
 * automation_logs.entity_id UUID column. SHA-256 → first 32 hex chars
 * arranged as 8-4-4-4-12 with the version-5 nibble + RFC 4122 variant
 * nibble set. Same email → same UUID. Used by the auth rate limiter
 * (Sentry JAVASCRIPT-NEXTJS-E4-14: rate limiter was 22P02-throwing on
 * every attempt before this).
 */
function emailToUuidKey(email: string): string {
  const hex = createHash("sha256").update(email.toLowerCase()).digest("hex");
  // Version 5 nibble (high 4 bits of byte 6) + RFC 4122 variant (high 2
  // bits of byte 8 set to 0b10). Both are positional; SHA-256 supplies
  // the rest of the entropy.
  const v = "5" + hex.slice(13, 16);
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16) + hex.slice(17, 20);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${v}-${variant}-${hex.slice(20, 32)}`;
}

// Cap how long the audit-log insert can hold. Even though it's wrapped in
// try/catch as fire-and-forget, an unbounded await would still hold the
// Server Action's response if audit_log got locked. 2s is well above a
// healthy insert (~30ms) and well below any user-perceivable wait.
const AUDIT_LOG_TIMEOUT_MS = 2000;

/**
 * Insert an audit_log row for a successful sign-in. Service-role client
 * because RLS policy on audit_log is INSERT-by-service-role-only. Fire-and-
 * forget — login latency must not depend on this.
 */
async function recordLogin(userId: string, email: string, role: string | null) {
  try {
    const h = await headers();
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    const userAgent = h.get("user-agent") ?? null;
    const admin = createAdminClient();
    await withTimeout(
      admin.from("audit_log").insert({
        changed_by: userId,
        table_name: "auth.users",
        record_id: userId,
        action: "LOGIN",
        old_data: null,
        new_data: { email, role, user_agent: userAgent },
        ip_address: ip,
        reason: "User signed in",
      }),
      AUDIT_LOG_TIMEOUT_MS,
      null as never,
      "recordLogin",
    );
  } catch (err) {
    logError("recordLogin failed (non-blocking)", err, { tag: "auth-audit" });
  }
}

export type AuthResult = {
  error?: string;
  success?: string;
};

const MAX_LOGIN_ATTEMPTS_PER_HOUR = 10;
const MAX_FORGOT_PASSWORD_PER_HOUR = 5;

// Emergency-glass for known administrator emails when BotID's client SDK
// fails to mint a token on their browser (extension, cache, ITP, automation
// tooling — Sentry shows ~1 user, not platform-wide, so this is targeted
// rather than disabling bot defense globally). Keyed on email because that's
// the only identifier available before checkBotId() runs server-side. The
// existing per-email rate limiter (MAX_LOGIN_ATTEMPTS_PER_HOUR=10) caps any
// stuffing attempt against an allow-listed address.
//
// Set in Vercel: BOTID_BYPASS_EMAILS="owner@example.com,ops@example.com"
const BOTID_BYPASS_EMAILS = (process.env.BOTID_BYPASS_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

function shouldBypassBotId(email: string | null | undefined): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  // .test TLD is a reserved fake domain — only exists in test accounts.
  if (normalized.endsWith("@furqan.test")) return true;
  return BOTID_BYPASS_EMAILS.includes(normalized);
}

/**
 * DB-backed per-identifier rate limiter for auth flows.
 * Keys on the email (lowercased) — IP rotation doesn't bypass it.
 * Fails open on DB errors so infra issues don't lock legitimate users out.
 */
async function checkAuthRate(
  workflow: "login-attempt" | "forgot-password-attempt",
  email: string,
  max: number,
): Promise<boolean> {
  // Skip rate limiting in dev (local) and for CI test accounts.
  if (process.env.NODE_ENV === "development") return true;
  if (email.toLowerCase().endsWith("@furqan.test")) return true;
  try {
    // Service-role client. The rate-limit check runs PRE-AUTHENTICATION
    // (the user has no session yet on POST /login or /forgot-password),
    // so the regular SSR client carries only the anon key. RLS on
    // automation_logs allows anon SELECT but not anon INSERT — the INSERT
    // was returning 401 and tripping the silent_fail observability hook
    // (Sentry JAVASCRIPT-NEXTJS-E4-1M). Service-role bypasses RLS for
    // both the count check and the row insert; the rate limiter is purely
    // server-side bookkeeping so privilege escalation is not a concern.
    const supabase = createAdminClient();
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    // automation_logs.entity_id is UUID-typed in production despite the
    // generated .ts declaring it `string | null`. Passing the raw email
    // tripped 22P02 (invalid input syntax for type uuid) on every login
    // attempt — the rate limiter has been silently fail-open since shipped.
    // (Sentry JAVASCRIPT-NEXTJS-E4-14.)
    //
    // Fix: deterministically hash the email to a UUID-shaped key via
    // SHA-256 + UUIDv5-style nibble formatting. Same email → same UUID,
    // type-correct on insert + lookup, no schema migration needed,
    // idempotency_key (UNIQUE text) stays free for n8n use.
    const entityId = emailToUuidKey(email);
    const { count } = await supabase
      .from("automation_logs")
      .select("id", { count: "exact", head: true })
      .eq("workflow_name", workflow)
      .eq("entity_id", entityId)
      .gte("started_at", oneHourAgo);

    if ((count ?? 0) >= max) return false;

    const now = new Date().toISOString();
    const { error: autoLogError } = await supabase.from("automation_logs").insert({
      workflow_name: workflow,
      entity_type: "email",
      entity_id: entityId,
      status: "succeeded",
      started_at: now,
      finished_at: now,
    });
    if (autoLogError) {
      logError(`${workflow} rate-limit log insert failed`, autoLogError, {
        tag: "auth-rate", workflow, entityId,
      });
    }
    return true;
  } catch (err) {
    logError(`${workflow} rate check failed — allowing request`, err, { tag: "auth-rate" });
    return true;
  }
}

/**
 * Rejects the obvious weak passwords without harassing users.
 * Requires 8+ chars and at least 2 of {lowercase, uppercase, digit}.
 */
function passwordIsWeak(password: string): boolean {
  if (password.length < 8) return true;
  const hasLower = /[a-z]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasDigit = /\d/.test(password);
  const classes = [hasLower, hasUpper, hasDigit].filter(Boolean).length;
  return classes < 2;
}

export async function login(
  _prev: AuthResult,
  formData: FormData,
): Promise<AuthResult> {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const redirectTo = formData.get("redirect") as string | null;

  // Three-state BotID policy:
  //   - allow-listed admin email → bypass entirely (still logged for audit)
  //   - confident bot            → block
  //   - confident human          → allow
  //   - ambiguous                → allow, but log so we can audit false positives
  // Pure fail-closed (`!isHuman`) misclassified real users (Kuwait Safari
  // 2026-05-01, /teach-with-us/apply incident). Credential-stuffing risk on the
  // ambiguous-allow path is capped by the per-email rate limit below.
  if (shouldBypassBotId(email)) {
    // Allow-listed admin bypass is expected behavior, not an error — log to
    // Sentry Logs (audit trail) via logInfo, not logError (which files an Issue
    // on every admin login: FURQAN-35/39).
    logInfo("BotID bypassed for allow-listed email", {
      component: "auth.login",
      tag: "auth-bot-bypass",
      metadata: { email },
    });
  } else if (process.env.VERCEL) {
    // checkBotId() calls mutateResponseHeadersBeforeFlush, a Vercel-only API.
    // Skip in non-Vercel environments (local dev, VPS) to avoid runtime throws.
    const verification = await checkBotId();
    if (verification.isBot) {
      logError("BotID flagged login as bot", new Error("login.bot_blocked"), {
        component: "auth.login",
        tag: "auth-bot-blocked",
        metadata: { email },
      });
      return { error: "تعذر التحقق من الطلب. حدِّث الصفحة وأعد المحاولة، أو جرّب من شبكة مختلفة. إذا استمرت المشكلة تواصل معنا عبر واتساب." };
    }
    if (!verification.isHuman) {
      logError("BotID ambiguous on login — allowing through", new Error("login.bot_ambiguous"), {
        component: "auth.login",
        tag: "auth-bot-ambiguous",
        metadata: { email },
      });
    }
  }

  if (!email || !password) {
    return { error: "البريد الإلكتروني وكلمة المرور مطلوبان" };
  }

  // Per-email rate limit — credential stuffing defense.
  // Bypass for @furqan.test accounts so CI/TestSprite runs are never blocked.
  const isTestAccount = email.toLowerCase().endsWith("@furqan.test");
  if (!isTestAccount && !(await checkAuthRate("login-attempt", email, MAX_LOGIN_ATTEMPTS_PER_HOUR))) {
    logError("Login rate limit exceeded", new Error("login.rate_limited"), {
      component: "auth.login",
      tag: "auth-rate-limited",
      metadata: { email },
    });
    return { error: "تم تجاوز المحاولات المسموحة — حاول خلال ساعة" };
  }

  const supabase = await createClient();

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    const signinErr = error as { status?: number; code?: string; message?: string };

    // ── Triage by error code ──────────────────────────────────────────
    // Supabase returns specific codes for the well-known failure modes.
    // For each *expected business case* we want a tailored UX message
    // and we explicitly do NOT log to Sentry — these aren't anomalies
    // worth paging on, they're normal user activity.
    //
    // Anything we don't recognize falls through to the generic logger
    // path so genuinely surprising failures (network, SDK, etc.) stay
    // visible.

    // Soft-deleted account: admin set ban_duration via softDeleteUser.
    // Show a clear suspended-account message instead of "wrong password"
    // so the user knows to contact support, not retry their password.
    if (signinErr.code === "user_banned") {
      return {
        error: `حسابك معلق — يرجى التواصل مع الدعم على ${CONTACT.email}`,
      };
    }

    // Wrong email or password: the most common failure, expected user
    // typo or stuffing attempt. Per-email rate limiter already gates
    // abuse; no value in flooding Sentry with these.
    if (signinErr.code === "invalid_credentials") {
      return { error: "البريد الإلكتروني أو كلمة المرور غير صحيحة" };
    }

    // Email signup pending verification — show actionable message.
    if (signinErr.code === "email_not_confirmed") {
      return {
        error: "يرجى تأكيد بريدك الإلكتروني أولاً (تحقق من صندوق الوارد)",
      };
    }

    // Anything else — genuinely unexpected. Log it.
    logError("Supabase signInWithPassword unexpected error", error, {
      component: "auth.login",
      tag: "auth-signin-unexpected",
      metadata: {
        email,
        supabaseStatus: signinErr.status,
        supabaseCode: signinErr.code,
        supabaseMessage: signinErr.message,
      },
    });
    return { error: "حدث خطأ، حاول مرة أخرى" };
  }

  // Resolve role first — needed for both the redirect and the audit-log payload.
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", data.user.id)
    .single<{ role: string }>();

  const role = profile?.role ?? "student";

  // Audit the sign-in. Fire-and-forget; never blocks the redirect.
  await recordLogin(data.user.id, email, role);

  getPostHogClient()?.capture({
    distinctId: data.user.id,
    event: "user_logged_in",
    properties: { role, method: "email" },
  });

  // If caller provided an explicit redirect (e.g. from ?redirect=/student/bookings), use it.
  // Validate via the shared guard: same-origin relative path only, rejecting
  // protocol-relative, backslash-bypass, CRLF, and traversal payloads.
  if (isSafeRelativePath(redirectTo)) {
    redirect(redirectTo);
  }

  redirect(`/${role}/dashboard`);
}

export async function register(
  _prev: AuthResult,
  formData: FormData,
): Promise<AuthResult> {
  // Read the raw email first so the bypass check can run before checkBotId().
  // Same rationale as login above (see BOTID_BYPASS_EMAILS docstring).
  // Full validation happens below via zod (repo rule: zod at the action boundary).
  const rawEmail = String(formData.get("email") ?? "");

  if (shouldBypassBotId(rawEmail)) {
    // See login bypass above — expected admin behavior, not an Issue-worthy error.
    logInfo("BotID bypassed for allow-listed email", {
      component: "auth.register",
      tag: "auth-bot-bypass",
      metadata: { email: rawEmail },
    });
  } else if (process.env.VERCEL) {
    // checkBotId() calls mutateResponseHeadersBeforeFlush, a Vercel-only API.
    // Skip in non-Vercel environments (local dev, VPS) to avoid runtime throws.
    const verification = await checkBotId();
    if (verification.isBot) {
      logError("BotID flagged register as bot", new Error("register.bot_blocked"), {
        component: "auth.register",
        tag: "auth-bot-blocked",
      });
      return { error: "تعذر التحقق من الطلب" };
    }
    if (!verification.isHuman) {
      logError("BotID ambiguous on register — allowing through", new Error("register.bot_ambiguous"), {
        component: "auth.register",
        tag: "auth-bot-ambiguous",
      });
    }
  }

  // Zod at the action boundary. `consent` must be the literal "yes" — this is
  // the enforcement layer for the terms/privacy clickwrap (Wave 0, decision 43);
  // the checkbox in the form is only the UI layer. An absent consent field
  // (hostile client stripping the checkbox) fails here.
  const parsed = registerSchema.safeParse({
    full_name: formData.get("full_name"),
    email: formData.get("email"),
    password: formData.get("password"),
    confirm_password: formData.get("confirm_password"),
    consent: formData.get("consent"),
    plan: formData.get("plan"),
  });

  if (!parsed.success) {
    return { error: registerErrorMessage(parsed.error) };
  }

  const { full_name: fullName, email, password, confirm_password: confirmPassword, plan: parsedPlan } = parsed.data;
  // parsedPlan is zod-validated parse output; the nullish default is a
  // validated edge case, not a silently-defaulted Supabase result. Kept on
  // its own line (off the parse destructure) so the silent-fail tripwire
  // (scripts/check-silent-fail.sh) does not false-positive on its
  // nullish-coalesce-on-a-query-result heuristic.
  const plan = parsedPlan ?? null;

  if (passwordIsWeak(password)) {
    return { error: "كلمة المرور ضعيفة — استخدم 8+ أحرف بخلطة من الحروف والأرقام" };
  }

  if (password !== confirmPassword) {
    return { error: "كلمتا المرور غير متطابقتين" };
  }

  // Preflight the service-role client BEFORE creating the account. Consent
  // evidence is release-blocking (Wave 0) and only the service role can write
  // it; if the admin client can't be built (missing/invalid service-role env),
  // fail here so we never leave a consent-less account behind. The dominant
  // failure mode is configuration, which is identical for every request.
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch (adminError) {
    logError("Admin client unavailable — cannot record signup consent", adminError, {
      component: "auth.register",
      tag: "auth-consent-record-failed",
    });
    return { error: "حدث خطأ أثناء إنشاء الحساب" };
  }

  const supabase = await createClient();

  const { data: signupData, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName,
      },
    },
  });

  if (error) {
    const signupErr = error as { status?: number; code?: string; message?: string };

    // Triage by error code, mirroring login() above. Expected business
    // cases get a tailored Arabic message and are NOT logged. Anything
    // unrecognized falls through to logError so genuinely surprising
    // failures (signup_disabled, SMTP, trigger errors) stay visible.

    // Email already in auth.users. Supabase has changed both the code
    // and the message string over time, so accept either form.
    //
    // SECURITY: do NOT reveal that the email exists — a distinct "already
    // registered" message is a user-enumeration oracle (harvest valid emails
    // for credential stuffing / phishing). Mirror the success path byte-for-
    // byte. Supabase still emails the existing user a security notice, so the
    // legitimate-owner UX is preserved while the response is indistinguishable
    // from a fresh signup. (Matches the already-safe login/forgot-password
    // flows.)
    if (
      signupErr.code === "user_already_exists" ||
      signupErr.code === "email_exists" ||
      signupErr.message?.includes("already registered")
    ) {
      redirect(plan ? `/login?registered=true&redirect=/subscribe?plan=${encodeURIComponent(plan)}` : "/login?registered=true");
    }

    if (signupErr.code === "signup_disabled") {
      return { error: "التسجيل متوقف مؤقتاً — تواصل معنا عبر واتساب" };
    }

    // Supabase Auth's own password checks (length, HaveIBeenPwned breach
    // corpus). Our client-side rule is looser, so this can fire even on
    // passwords that pass our UI validation.
    if (
      signupErr.code === "weak_password" ||
      signupErr.code === "password_compromised"
    ) {
      return { error: "كلمة المرور سهلة التخمين — اختر كلمة مرور أقوى" };
    }

    // Supabase per-IP signup limit, separate from our automation_logs
    // limiter (which only covers login + forgot-password).
    if (
      signupErr.code === "over_email_send_rate_limit" ||
      signupErr.code === "over_request_rate_limit"
    ) {
      return { error: "تم تجاوز المحاولات المسموحة — حاول خلال ساعة" };
    }

    if (signupErr.code === "validation_failed") {
      return { error: "تحقق من البريد الإلكتروني وأعد المحاولة" };
    }

    logError("Supabase signUp unexpected error", error, {
      component: "auth.register",
      tag: "auth-signup-unexpected",
      metadata: {
        email,
        supabaseStatus: signupErr.status,
        supabaseCode: signupErr.code,
        supabaseMessage: signupErr.message,
      },
    });
    return { error: "حدث خطأ أثناء إنشاء الحساب" };
  }

  if (signupData?.user?.id) {
    const userId = signupData.user.id;
    // Persist consent evidence in app_metadata (admin-only writable — the user
    // cannot alter it via updateUser, unlike user_metadata). Release-blocking:
    // if the write fails, roll the signup back by deleting the just-created,
    // session-less user so no consent-less account lingers. A retry is then a
    // clean fresh signup rather than the enumeration-obfuscated
    // user_already_exists branch, which cannot safely re-attach consent.
    try {
      const { error: consentErr } = await admin.auth.admin.updateUserById(
        userId,
        { app_metadata: { consent: buildConsentRecord("checkbox") } },
      );
      if (consentErr) throw consentErr;
    } catch (consentError) {
      logError("Failed to record signup consent in app_metadata", consentError, {
        component: "auth.register",
        tag: "auth-consent-record-failed",
        metadata: { userId },
      });
      // Best-effort rollback; if the delete also fails, the loud log above is
      // the reconciliation signal for ops.
      try {
        await admin.auth.admin.deleteUser(userId);
      } catch (rollbackError) {
        logError("Failed to roll back consent-less signup", rollbackError, {
          component: "auth.register",
          tag: "auth-consent-rollback-failed",
          metadata: { userId },
        });
      }
      return { error: "تعذّر إتمام التسجيل — حاول مرة أخرى" };
    }

    getPostHogClient()?.capture({
      distinctId: signupData.user.id,
      event: "user_signed_up",
      properties: { method: "email", has_plan: !!plan },
    });
  }

  redirect(plan ? `/login?registered=true&redirect=/subscribe?plan=${encodeURIComponent(plan)}` : "/login?registered=true");
}

export async function forgotPassword(
  _prev: AuthResult,
  formData: FormData,
): Promise<AuthResult> {
  const email = formData.get("email") as string;

  if (!email) {
    return { error: "البريد الإلكتروني مطلوب" };
  }

  // Per-email rate limit — prevents password reset spam abuse
  if (!(await checkAuthRate("forgot-password-attempt", email, MAX_FORGOT_PASSWORD_PER_HOUR))) {
    return { error: "تم تجاوز المحاولات المسموحة — حاول خلال ساعة" };
  }

  const supabase = await createClient();

  // Fallback to production domain if env is missing/blank — without this,
  // the redirectTo template stringifies to "undefined/login" and Supabase
  // rejects the call with a generic error.
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || "https://www.furqan.today";
  const redirectTo = `${appUrl}/login`;

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo,
  });

  if (error) {
    // AuthApiError has .status (HTTP) + .code (Supabase code). Both
    // are the smoking gun for what's wrong (rate limit vs SMTP fail
    // vs invalid recipient). Sentry's default Error serialization
    // strips them, so we lift them into metadata explicitly.
    const supabaseError = error as { status?: number; code?: string; message?: string };
    logError("resetPasswordForEmail failed", error, {
      component: "auth.forgotPassword",
      tag: "auth-forgot-password",
      metadata: {
        email,
        redirectTo,
        supabaseStatus: supabaseError.status,
        supabaseCode: supabaseError.code,
        supabaseMessage: supabaseError.message,
      },
    });
    return { error: "حدث خطأ، حاول مرة أخرى" };
  }

  return { success: "تم إرسال رابط إعادة تعيين كلمة المرور إلى بريدك الإلكتروني" };
}
