"use server";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin, ForbiddenError } from "@/lib/auth/require-admin";
import { logError } from "@/lib/logger";

async function authOrError(): Promise<{ id?: string; error?: string }> {
  try {
    return { id: (await requireAdmin()).id };
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "ليس لديك صلاحية" };
    throw e;
  }
}

export async function toggleUserActive(userId: string, isActive: boolean) {
  const auth = await authOrError();
  if (auth.error) return { error: auth.error };

  const admin = createAdminClient();

  // Fetch existing for audit
  const { data: existing } = await admin
    .from("profiles")
    .select("is_active")
    .eq("id", userId)
    .single<{ is_active: boolean }>();

  const { error } = await admin.from("profiles").update({ is_active: isActive } as never).eq("id", userId);
  if (error) return { error: "فشل تحديث حالة المستخدم" };

  await admin.from("audit_log").insert({
    changed_by: auth.id,
    table_name: "profiles",
    record_id: userId,
    action: "UPDATE",
    old_data: { is_active: existing?.is_active ?? null },
    new_data: { is_active: isActive },
    reason: isActive ? "Admin reactivated user" : "Admin deactivated user",
  } as never);

  revalidatePath("/admin/users");
  return { success: true };
}

export async function changeUserRole(userId: string, role: string) {
  const auth = await authOrError();
  if (auth.error) return { error: auth.error };

  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .single<{ role: string }>();

  const { error } = await admin.from("profiles").update({ role } as never).eq("id", userId);
  if (error) return { error: "فشل تغيير الدور — تأكد من صلاحيات المدير" };

  await admin.from("audit_log").insert({
    changed_by: auth.id,
    table_name: "profiles",
    record_id: userId,
    action: "UPDATE",
    old_data: { role: existing?.role ?? null },
    new_data: { role },
    reason: `Admin changed role: ${existing?.role ?? "unknown"} → ${role}`,
  } as never);

  if (role === "teacher") {
    const { data: teacherProfile } = await admin
      .from("teacher_profiles")
      .select("teacher_id")
      .eq("teacher_id", userId)
      .single();

    if (!teacherProfile) {
      const { error: tpInsertErr } = await admin.from("teacher_profiles").insert({
        teacher_id: userId,
        specialties: [],
        hourly_rate: 20,
        languages: ["ar"],
        recitation_standards: ["hafs"],
        cv_status: "approved",
        cv_submitted_at: new Date().toISOString(),
      } as never);
      if (tpInsertErr) {
        logError("changeUserRole: teacher_profiles auto-insert failed", tpInsertErr, { tag: "admin-users" });
      }
    }
  }

  if (role !== "teacher") {
    const { error: archiveErr } = await admin.from("teacher_profiles").update({
      is_archived: true,
      archived_at: new Date().toISOString(),
    } as never).eq("teacher_id", userId);
    if (archiveErr) {
      logError("changeUserRole: teacher_profiles auto-archive failed", archiveErr, { tag: "admin-users" });
    }
  }

  revalidatePath("/admin/users");
  revalidatePath("/admin/teachers");
  return { success: true };
}

/**
 * Soft-delete a user. Sets profiles.deleted_at = now() and is_active=false,
 * AND bans the auth user via the admin SDK so they can no longer sign in.
 *
 * Soft delete (not hard) because profiles.id is FK'd from many tables
 * (bookings, sessions, evaluations, payments, etc.); a hard DELETE would
 * either fail or cascade-destroy history we want to keep for audit/billing.
 *
 * Self-protection: an admin can't delete their own account.
 *
 * Reversible via restoreUser().
 */
export async function softDeleteUser(userId: string, reason: string) {
  const auth = await authOrError();
  if (auth.error) return { error: auth.error };
  if (auth.id === userId) return { error: "لا يمكنك حذف حسابك الخاص" };

  const trimmed = (reason ?? "").trim();
  if (trimmed.length < 3) return { error: "يرجى إدخال سبب واضح للحذف" };

  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("profiles")
    .select("role, full_name, is_active, deleted_at")
    .eq("id", userId)
    .single<{ role: string; full_name: string | null; is_active: boolean; deleted_at: string | null }>();

  if (!existing) return { error: "المستخدم غير موجود" };
  if (existing.deleted_at) return { error: "المستخدم محذوف بالفعل" };

  const now = new Date().toISOString();

  const { error: profileErr } = await admin.from("profiles").update({
    is_active: false,
    deleted_at: now,
  } as never).eq("id", userId);

  if (profileErr) return { error: "فشل حذف المستخدم: " + profileErr.message };

  // Best-effort: revoke auth so the user can no longer sign in. If this fails,
  // the profile is still flagged deleted_at + inactive — login still blocked
  // by middleware role check + is_active filter.
  try {
    await admin.auth.admin.updateUserById(userId, { ban_duration: "8760h" }); // 1 year
  } catch {
    /* non-blocking */
  }

  // If the deleted user was a teacher, archive the teacher_profiles row too.
  if (existing.role === "teacher") {
    const { error: archiveErr } = await admin.from("teacher_profiles").update({
      is_archived: true,
      archived_at: now,
    } as never).eq("teacher_id", userId);
    if (archiveErr) logError("softDeleteUser: teacher_profiles archive failed", archiveErr, { tag: "admin-users" });
  }

  await admin.from("audit_log").insert({
    changed_by: auth.id,
    table_name: "profiles",
    record_id: userId,
    action: "DELETE",
    old_data: { is_active: existing.is_active, deleted_at: null },
    new_data: { is_active: false, deleted_at: now },
    reason: `Admin soft-deleted user (${existing.role}): ${trimmed}`,
  } as never);

  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${userId}`);
  if (existing.role === "teacher") revalidatePath("/admin/teachers");

  return { success: true };
}

/**
 * Reverse softDeleteUser. Clears deleted_at, sets is_active=true, lifts ban.
 */
export async function restoreUser(userId: string) {
  const auth = await authOrError();
  if (auth.error) return { error: auth.error };

  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("profiles")
    .select("role, deleted_at")
    .eq("id", userId)
    .single<{ role: string; deleted_at: string | null }>();

  if (!existing) return { error: "المستخدم غير موجود" };
  if (!existing.deleted_at) return { error: "المستخدم ليس محذوفاً" };

  const { error: profileErr } = await admin.from("profiles").update({
    is_active: true,
    deleted_at: null,
  } as never).eq("id", userId);

  if (profileErr) return { error: "فشل استعادة المستخدم" };

  try {
    await admin.auth.admin.updateUserById(userId, { ban_duration: "none" });
  } catch {
    /* non-blocking */
  }

  if (existing.role === "teacher") {
    const { error: unarchiveErr } = await admin.from("teacher_profiles").update({
      is_archived: false,
      archived_at: null,
    } as never).eq("teacher_id", userId);
    if (unarchiveErr) logError("restoreUser: teacher_profiles unarchive failed", unarchiveErr, { tag: "admin-users" });
  }

  await admin.from("audit_log").insert({
    changed_by: auth.id,
    table_name: "profiles",
    record_id: userId,
    action: "UPDATE",
    old_data: { is_active: false, deleted_at: existing.deleted_at },
    new_data: { is_active: true, deleted_at: null },
    reason: "Admin restored deleted user",
  } as never);

  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${userId}`);
  if (existing.role === "teacher") revalidatePath("/admin/teachers");

  return { success: true };
}

export async function createUserFromScratch(
  _prev: { success?: boolean; error?: string },
  formData: FormData
): Promise<{ success?: boolean; error?: string }> {
  const auth = await authOrError();
  if (auth.error) return { error: auth.error };

  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const full_name = formData.get("full_name") as string;
  const role = formData.get("role") as string;
  const phone = (formData.get("phone") as string) || null;
  const country = (formData.get("country") as string) || null;
  const parent_name = (formData.get("parent_name") as string) || null;
  const parent_phone = (formData.get("parent_phone") as string) || null;
  const parent_email = (formData.get("parent_email") as string) || null;
  const date_of_birth = (formData.get("date_of_birth") as string) || null;

  if (!email || !password || !full_name || !role) {
    return { error: "جميع الحقول المطلوبة يجب ملؤها" };
  }

  if (!["student", "teacher", "moderator"].includes(role)) {
    return { error: "دور غير صالح" };
  }

  if (password.length < 8) {
    return { error: "كلمة المرور يجب أن تكون 8 أحرف على الأقل" };
  }

  const adminClient = createAdminClient();

  const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name },
  });

  if (authError || !authData.user) {
    if (authError?.message?.includes("already been registered")) {
      return { error: "البريد الإلكتروني مسجل بالفعل" };
    }
    return { error: authError?.message ?? "فشل إنشاء المستخدم" };
  }

  const userId = authData.user.id;

  const { error: profileError } = await adminClient.from("profiles").update({
    role,
    full_name,
    phone,
    country,
    parent_name,
    parent_phone,
    parent_email,
    date_of_birth,
  } as never).eq("id", userId);

  if (profileError) {
    return { error: "تم إنشاء المستخدم لكن فشل تحديث الملف الشخصي" };
  }

  if (role === "teacher") {
    // Admin-created teachers are pre-vetted off-platform — go straight to
    // approved so they appear on /teachers-page immediately. Self-applied
    // teachers via /teach/apply still land in pending_review for review.
    // Capture the error so we never silently end up with a teacher profile
    // missing its teacher_profiles row (Ahmed Sokar incident, 2026-04-26).
    const { error: tpError } = await adminClient.from("teacher_profiles").insert({
      teacher_id: userId,
      specialties: [],
      hourly_rate: 20,
      languages: ["ar"],
      recitation_standards: ["hafs"],
      cv_status: "approved",
      cv_submitted_at: new Date().toISOString(),
    } as never);
    if (tpError) {
      return { error: `تم إنشاء الحساب لكن فشل إنشاء ملف المعلم: ${tpError.message}` };
    }
  }

  await adminClient.from("audit_log").insert({
    changed_by: auth.id,
    table_name: "profiles",
    record_id: userId,
    action: "INSERT",
    old_data: null,
    new_data: { email, role, full_name, country },
    reason: `Admin created ${role} account`,
  } as never);

  revalidatePath("/admin/users");
  return { success: true };
}
