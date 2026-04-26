"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { checkBotId } from "botid/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logError } from "@/lib/logger";

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
    await admin.from("audit_log").insert({
      changed_by: userId,
      table_name: "auth.users",
      record_id: userId,
      action: "LOGIN",
      old_data: null,
      new_data: { email, role, user_agent: userAgent },
      ip_address: ip,
      reason: "User signed in",
    } as never);
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
  try {
    const supabase = await createClient();
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count } = await supabase
      .from("automation_logs")
      .select("id", { count: "exact", head: true })
      .eq("workflow_name", workflow)
      .eq("entity_id", email.toLowerCase())
      .gte("started_at", oneHourAgo);

    if ((count ?? 0) >= max) return false;

    const now = new Date().toISOString();
    await supabase.from("automation_logs").insert({
      workflow_name: workflow,
      entity_type: "email",
      entity_id: email.toLowerCase(),
      status: "succeeded",
      started_at: now,
      finished_at: now,
    } as never);
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

  const verification = await checkBotId();
  if (verification.isBot) {
    // BotID has misclassified real users in the past (cf. /teach/apply
    // incident). Logging when this fires so we can tell apart real bots
    // from false positives by inspecting the Sentry event's IP/UA.
    logError("BotID flagged login as bot", new Error("login.bot_blocked"), {
      component: "auth.login",
      tag: "auth-bot-blocked",
      metadata: { email },
    });
    return { error: "تعذر التحقق من الطلب" };
  }

  if (!email || !password) {
    return { error: "البريد الإلكتروني وكلمة المرور مطلوبان" };
  }

  // Per-email rate limit — credential stuffing defense
  if (!(await checkAuthRate("login-attempt", email, MAX_LOGIN_ATTEMPTS_PER_HOUR))) {
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
        error: "حسابك معلق — يرجى التواصل مع الدعم على alforqan.egy@gmail.com",
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

  // If caller provided an explicit redirect (e.g. from ?redirect=/student/bookings), use it
  // Validate: must be a relative path (starts with /) and not protocol-relative (//)
  if (redirectTo && redirectTo.startsWith("/") && !redirectTo.startsWith("//")) {
    redirect(redirectTo);
  }

  redirect(`/${role}/dashboard`);
}

export async function register(
  _prev: AuthResult,
  formData: FormData,
): Promise<AuthResult> {
  const verification = await checkBotId();
  if (verification.isBot) {
    return { error: "تعذر التحقق من الطلب" };
  }

  const fullName = formData.get("full_name") as string;
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const confirmPassword = formData.get("confirm_password") as string;

  if (!fullName || !email || !password) {
    return { error: "جميع الحقول مطلوبة" };
  }

  if (passwordIsWeak(password)) {
    return { error: "كلمة المرور ضعيفة — استخدم 8+ أحرف بخلطة من الحروف والأرقام" };
  }

  if (password !== confirmPassword) {
    return { error: "كلمتا المرور غير متطابقتين" };
  }

  const supabase = await createClient();

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName,
      },
    },
  });

  if (error) {
    if (error.message.includes("already registered")) {
      return { error: "هذا البريد الإلكتروني مسجل بالفعل" };
    }
    return { error: "حدث خطأ أثناء إنشاء الحساب" };
  }

  redirect("/login?registered=true");
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
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || "https://furqan.today";
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
