"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, ForbiddenError } from "@/lib/auth/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { notify } from "@/lib/notifications/dispatcher";

export interface GrantResult {
  success?: string;
  error?: string;
}

interface StudentLookup {
  id: string;
  full_name: string;
}

interface ActivePackage {
  id: string;
  sessions_total: number;
  sessions_used: number;
  expires_at: string | null;
}

export async function grantCreditAction(
  _prev: GrantResult,
  formData: FormData,
): Promise<GrantResult> {
  let actor: { id: string };
  try {
    actor = await requireAdmin();
  } catch (e) {
    if (e instanceof ForbiddenError) {
      return { error: e.message === "not authenticated" ? "غير مصرح" : "هذا الإجراء للمشرفين فقط" };
    }
    throw e;
  }

  const email = String(formData.get("student_email") ?? "").trim().toLowerCase();
  const sessions = Number(formData.get("sessions") ?? 0);
  const reason = String(formData.get("reason") ?? "").trim();

  if (!email) return { error: "البريد الإلكتروني مطلوب" };
  if (!Number.isInteger(sessions) || sessions < 1 || sessions > 50) {
    return { error: "عدد الجلسات يجب أن يكون بين 1 و 50" };
  }
  if (!reason || reason.length < 3) return { error: "يرجى إدخال سبب واضح للمنح" };

  // Service-role client: we're looking up a user and mutating their package.
  // Admin auth already verified above.
  const admin = createAdminClient();

  // email lives on auth.users, not public.profiles — resolve via admin auth.
  const { data: authList } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const authUser = authList?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!authUser) return { error: "لم يتم العثور على الطالب بهذا البريد" };

  const { data: student } = await admin
    .from("profiles")
    .select("id, full_name")
    .eq("id", authUser.id)
    .eq("role", "student")
    .single<StudentLookup>();
  if (!student) return { error: "لم يتم العثور على الطالب بهذا البريد" };

  // Find the student's most-relevant active package (soonest to expire, else
  // the one with fewest remaining).
  const { data: packages } = await admin
    .from("student_packages")
    .select("id, sessions_total, sessions_used, expires_at")
    .eq("student_id", student.id)
    .eq("status", "active")
    .order("expires_at", { ascending: true, nullsFirst: false })
    .returns<ActivePackage[]>();

  const activePkg = packages?.[0];
  if (!activePkg) {
    return {
      error: "لا توجد باقة نشطة لهذا الطالب — أنشئ باقة أولاً من صفحة الباقات",
    };
  }

  // Increase sessions_total by the granted count.
  const { error: updateErr } = await admin
    .from("student_packages")
    .update({ sessions_total: activePkg.sessions_total + sessions } as never)
    .eq("id", activePkg.id);
  if (updateErr) return { error: "تعذر تحديث الباقة: " + updateErr.message };

  // Audit log entry — admin gets-credit actions must leave a trail.
  await admin.from("audit_log").insert({
    changed_by: actor.id,
    table_name: "student_packages",
    record_id: activePkg.id,
    action: "UPDATE",
    old_data: { sessions_total: activePkg.sessions_total },
    new_data: { sessions_total: activePkg.sessions_total + sessions, granted: sessions },
    reason: `Manual credit grant (${sessions} sessions): ${reason}`,
  } as never);

  // Notify the student.
  try {
    await notify(
      student.id,
      "system",
      "تمت إضافة جلسات إلى باقتك",
      `أضاف المشرف ${sessions} جلسة${sessions > 1 ? "" : ""} إلى باقتك. السبب: ${reason}`,
      "student_package",
      activePkg.id,
    );
  } catch { /* non-blocking */ }

  revalidatePath("/admin/credits");
  revalidatePath("/student/packages");
  return {
    success: `تم منح ${sessions} جلسة${sessions > 1 ? "" : ""} للطالب ${student.full_name}. رصيده الجديد: ${activePkg.sessions_total + sessions - activePkg.sessions_used}`,
  };
}
