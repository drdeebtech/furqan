"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loudAction, type LoudResult } from "@/lib/actions/loud";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Tagged error wrapper for "user-facing-but-not-infra-fault" messages.
// Reaching loudAction's generic catch with this still triggers the
// audit_log row marked FAILED (security telemetry: failed-credential
// attempts are worth retaining), but Sentry queries can filter by
// tag = "user-error" to keep noise out of infra dashboards.
class UserError extends Error {
  readonly userError = true;
  constructor(msg: string) { super(msg); this.name = "UserError"; }
}

const passwordSchema = z.object({
  current_password: z.string().min(1, "كلمة المرور الحالية مطلوبة"),
  new_password: z.string().min(8, "كلمة المرور يجب أن تكون 8 أحرف على الأقل"),
  confirm_password: z.string().min(1, "تأكيد كلمة المرور مطلوب"),
}).refine((d) => d.new_password === d.confirm_password, {
  message: "كلمتا المرور غير متطابقتين",
  path: ["confirm_password"],
});

const emailSchema = z.object({
  new_email: z.string().min(1, "البريد الإلكتروني الجديد مطلوب"),
  current_password: z.string().min(1, "كلمة المرور الحالية مطلوبة"),
}).transform((d) => ({ ...d, new_email: d.new_email.trim().toLowerCase() }))
  .refine((d) => EMAIL_RE.test(d.new_email), {
    message: "البريد الإلكتروني غير صالح",
    path: ["new_email"],
  });

// Shared password-change action used by every role's settings page.
// Verifies the current password via the admin client (so the user's session
// cookies aren't disturbed by the verification sign-in), then updates via
// the regular client (which has the active session).
const updatePasswordBase = loudAction<z.infer<typeof passwordSchema>, { message: string }>({
  name: "account.update-password",
  severity: "warning",
  schema: passwordSchema,
  audit: { table: "auth.users", recordId: () => "self", action: "UPDATE" },
  preflight: async () => {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || !user.email) throw new UserError("غير مصرح");
    return { actorId: user.id };
  },
  handler: async ({ current_password, new_password }, { actorId }) => {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || !user.email || user.id !== actorId) throw new UserError("غير مصرح");

    // Verify current password via admin client to avoid disturbing the
    // active session cookies. signInWithPassword on the regular client
    // would rotate the access token mid-action.
    const adminClient = createAdminClient();
    const { error: verifyErr } = await adminClient.auth.signInWithPassword({
      email: user.email,
      password: current_password,
    });
    if (verifyErr) throw new UserError("كلمة المرور الحالية غير صحيحة");

    const { error: updErr } = await supabase.auth.updateUser({ password: new_password });
    if (updErr) throw updErr;

    return { message: "تم تحديث كلمة المرور بنجاح" };
  },
});

export async function updatePassword(
  _prev: LoudResult | null,
  formData: FormData,
): Promise<LoudResult> {
  return updatePasswordBase({
    current_password: String(formData.get("current_password") ?? ""),
    new_password: String(formData.get("new_password") ?? ""),
    confirm_password: String(formData.get("confirm_password") ?? ""),
  });
}

// Email change. Same security pattern as password: verify the current
// password via the admin client, then trigger the change via the regular
// client. Supabase sends a confirmation link to BOTH the old and new
// addresses (configurable in dashboard); the change doesn't take effect
// until the user clicks. Showing "pending until confirmed" to the user
// is a UX detail handled by the caller.
const updateEmailBase = loudAction<z.infer<typeof emailSchema>, { message: string }>({
  name: "account.update-email",
  severity: "warning",
  schema: emailSchema,
  audit: { table: "auth.users", recordId: () => "self", action: "UPDATE" },
  preflight: async () => {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || !user.email) throw new UserError("غير مصرح");
    return { actorId: user.id };
  },
  handler: async ({ new_email, current_password }, { actorId }) => {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || !user.email || user.id !== actorId) throw new UserError("غير مصرح");

    if (new_email === user.email.toLowerCase()) {
      throw new UserError("هذا هو بريدك الحالي بالفعل");
    }

    const adminClient = createAdminClient();
    const { error: verifyErr } = await adminClient.auth.signInWithPassword({
      email: user.email,
      password: current_password,
    });
    if (verifyErr) throw new UserError("كلمة المرور الحالية غير صحيحة");

    const { error: updErr } = await supabase.auth.updateUser({ email: new_email });
    if (updErr) throw updErr;

    return {
      message: `تم إرسال رابط التأكيد إلى ${new_email} — لن يتغير البريد حتى تضغط على الرابط`,
    };
  },
});

export async function updateEmail(
  _prev: LoudResult | null,
  formData: FormData,
): Promise<LoudResult> {
  return updateEmailBase({
    new_email: String(formData.get("new_email") ?? ""),
    current_password: String(formData.get("current_password") ?? ""),
  });
}
