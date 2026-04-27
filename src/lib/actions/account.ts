"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { LoudResult } from "@/lib/actions/loud";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Shared password-change action used by every role's settings page.
// Verifies the current password via the admin client (so the user's session
// cookies aren't disturbed by the verification sign-in), then updates via
// the regular client (which has the active session).
export async function updatePassword(
  _prev: LoudResult | null,
  formData: FormData,
): Promise<LoudResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email) return { ok: false, error: "غير مصرح" };

  const currentPassword = formData.get("current_password");
  const newPassword = formData.get("new_password");
  const confirmPassword = formData.get("confirm_password");

  if (typeof currentPassword !== "string" || typeof newPassword !== "string" || typeof confirmPassword !== "string") {
    return { ok: false, error: "جميع الحقول مطلوبة" };
  }
  if (newPassword !== confirmPassword) {
    return { ok: false, error: "كلمتا المرور غير متطابقتين" };
  }
  if (newPassword.length < 8) {
    return { ok: false, error: "كلمة المرور يجب أن تكون 8 أحرف على الأقل" };
  }

  const adminClient = createAdminClient();
  const { error: verifyErr } = await adminClient.auth.signInWithPassword({
    email: user.email,
    password: currentPassword,
  });
  if (verifyErr) {
    return { ok: false, error: "كلمة المرور الحالية غير صحيحة" };
  }

  const { error: updErr } = await supabase.auth.updateUser({ password: newPassword });
  if (updErr) {
    return { ok: false, error: "فشل تحديث كلمة المرور — حاول مرة أخرى" };
  }

  return { ok: true, message: "تم تحديث كلمة المرور بنجاح" };
}

// Email change. Same security pattern as password: verify the current
// password via the admin client, then trigger the change via the regular
// client. Supabase sends a confirmation link to BOTH the old and new
// addresses (configurable in dashboard); the change doesn't take effect
// until the user clicks. Showing "pending until confirmed" to the user
// is a UX detail handled by the caller.
export async function updateEmail(
  _prev: LoudResult | null,
  formData: FormData,
): Promise<LoudResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email) return { ok: false, error: "غير مصرح" };

  const newEmail = formData.get("new_email");
  const currentPassword = formData.get("current_password");

  if (typeof newEmail !== "string" || typeof currentPassword !== "string") {
    return { ok: false, error: "جميع الحقول مطلوبة" };
  }
  const trimmedEmail = newEmail.trim().toLowerCase();
  if (!EMAIL_RE.test(trimmedEmail)) {
    return { ok: false, error: "البريد الإلكتروني غير صالح" };
  }
  if (trimmedEmail === user.email.toLowerCase()) {
    return { ok: false, error: "هذا هو بريدك الحالي بالفعل" };
  }

  const adminClient = createAdminClient();
  const { error: verifyErr } = await adminClient.auth.signInWithPassword({
    email: user.email,
    password: currentPassword,
  });
  if (verifyErr) {
    return { ok: false, error: "كلمة المرور الحالية غير صحيحة" };
  }

  const { error: updErr } = await supabase.auth.updateUser({ email: trimmedEmail });
  if (updErr) {
    return { ok: false, error: "فشل تغيير البريد — حاول مرة أخرى" };
  }

  return {
    ok: true,
    message: `تم إرسال رابط التأكيد إلى ${trimmedEmail} — لن يتغير البريد حتى تضغط على الرابط`,
  };
}
