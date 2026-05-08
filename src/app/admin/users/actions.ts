"use server";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import type { TableInsert, TableUpdate } from "@/lib/supabase/typed-helpers";
import { requireAdmin, ForbiddenError } from "@/lib/auth/require-admin";
import { invalidateRoleCache } from "@/lib/auth/role-cache";
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

  const { error } = await admin.from("profiles").update({ is_active: isActive } satisfies TableUpdate<"profiles">).eq("id", userId);
  if (error) {
    logError("admin updateUserStatus failed", error, { tag: "admin-users", severity: "warning", metadata: { userId, isActive } });
    return { error: "فشل تحديث حالة المستخدم" };
  }

  await admin.from("audit_log").insert({
    changed_by: auth.id,
    table_name: "profiles",
    record_id: userId,
    action: "UPDATE",
    old_data: { is_active: existing?.is_active ?? null },
    new_data: { is_active: isActive },
    reason: isActive ? "Admin reactivated user" : "Admin deactivated user",
  } satisfies TableInsert<"audit_log">).then((r) => {
    if (r.error) logError("toggleUserActive: audit row failed", r.error, { tag: "admin-users" });
  });

  revalidatePath("/admin/users");
  return { success: true };
}

type UserRole = "student" | "teacher" | "admin";
const ALL_ROLES: ReadonlyArray<UserRole> = ["student", "teacher", "admin"];

/**
 * Set the full role *set* for a user — supports multi-role profiles.
 *
 * Behaviour:
 * - Validates that `roles` is non-empty and contains only known values.
 * - If the user's current active role is not in the new set, the active
 *   role is auto-rotated to the first element of the new set so the DB
 *   CHECK constraint (`profiles_active_role_in_set`) holds.
 * - If `'teacher'` is being newly added, the matching `teacher_profiles`
 *   row is bootstrapped (admin-created teachers are pre-vetted, cv_status
 *   set to 'approved').
 * - If `'teacher'` is being removed entirely, the `teacher_profiles` row
 *   is archived (matches `softDeleteUser` behaviour).
 * - Bumps the per-user role cache so the change lands on the next request.
 *
 * Audit row records both the prior and new role *and* roles[].
 */
export async function setUserRoles(userId: string, roles: string[]) {
  const auth = await authOrError();
  if (auth.error) return { error: auth.error };

  // Dedupe + validate. Empty set is rejected (a user with zero roles
  // would be locked out and the CHECK constraint would refuse the write).
  const dedup = Array.from(new Set(roles)) as UserRole[];
  if (dedup.length === 0) return { error: "يجب اختيار دور واحد على الأقل" };
  for (const r of dedup) {
    if (!ALL_ROLES.includes(r)) return { error: `دور غير صالح: ${r}` };
  }

  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("profiles")
    .select("role, roles")
    .eq("id", userId)
    .single<{ role: UserRole; roles: UserRole[] | null }>();
  if (!existing) return { error: "المستخدم غير موجود" };

  const oldRoles = existing.roles ?? [existing.role];
  const oldActive = existing.role;
  // Keep the user's active role if it's still in the new set, otherwise
  // pick the first role of the new set so the CHECK constraint holds.
  const newActive: UserRole = dedup.includes(oldActive) ? oldActive : dedup[0];

  const { error } = await admin.from("profiles").update({
    roles: dedup,
    role: newActive,
  } satisfies TableUpdate<"profiles">).eq("id", userId);
  if (error) {
    logError("admin updateUserRoles failed", error, { tag: "admin-users", severity: "warning", metadata: { userId, roles: dedup } });
    return { error: "فشل تحديث الأدوار — " + error.message };
  }

  invalidateRoleCache(userId);

  await admin.from("audit_log").insert({
    changed_by: auth.id,
    table_name: "profiles",
    record_id: userId,
    action: "UPDATE",
    old_data: { role: oldActive, roles: oldRoles },
    new_data: { role: newActive, roles: dedup },
    reason: `Admin set roles: [${oldRoles.join(",")}] → [${dedup.join(",")}]`,
  } satisfies TableInsert<"audit_log">).then((r) => {
    if (r.error) logError("setUserRoles: audit row failed", r.error, { tag: "admin-users" });
  });

  // teacher_profiles bookkeeping driven by membership change, not active role.
  const wasTeacher = oldRoles.includes("teacher");
  const isTeacher = dedup.includes("teacher");

  if (!wasTeacher && isTeacher) {
    // Newly granted teacher role — bootstrap the teacher_profiles row if
    // missing. Mirror the createUserFromScratch defaults.
    const { data: tp } = await admin
      .from("teacher_profiles")
      .select("teacher_id")
      .eq("teacher_id", userId)
      .single();
    if (!tp) {
      const { error: tpInsertErr } = await admin.from("teacher_profiles").insert({
        teacher_id: userId,
        specialties: [],
        hourly_rate: 20,
        languages: ["ar"],
        recitation_standards: ["hafs"],
        cv_status: "approved",
        cv_submitted_at: new Date().toISOString(),
      } satisfies TableInsert<"teacher_profiles">);
      if (tpInsertErr) {
        logError("setUserRoles: teacher_profiles auto-insert failed", tpInsertErr, { tag: "admin-users" });
      }
    }
  } else if (wasTeacher && !isTeacher) {
    // Teacher role removed entirely — archive (don't delete) the row so
    // historical bookings and follow-up keep their FK target.
    const { error: archiveErr } = await admin.from("teacher_profiles").update({
      is_archived: true,
      archived_at: new Date().toISOString(),
    } satisfies TableUpdate<"teacher_profiles">).eq("teacher_id", userId);
    if (archiveErr) {
      logError("setUserRoles: teacher_profiles auto-archive failed", archiveErr, { tag: "admin-users" });
    }
  }

  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${userId}`);
  revalidatePath("/admin/teachers");
  return { success: true };
}

/**
 * Legacy single-role mutator. Kept as a thin wrapper around `setUserRoles`
 * so existing call sites (`/admin/users/[id]/page.tsx` and friends) keep
 * working until they migrate to multi-select. Equivalent to "the user's
 * only role is now X."
 */
export async function changeUserRole(userId: string, role: string) {
  return setUserRoles(userId, [role]);
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
  } satisfies TableUpdate<"profiles">).eq("id", userId);

  if (profileErr) return { error: "فشل حذف المستخدم: " + profileErr.message };

  // Best-effort: revoke auth so the user can no longer sign in. If this fails,
  // the profile is still flagged deleted_at + inactive — login still blocked
  // by middleware role check + is_active filter.
  try {
    await admin.auth.admin.updateUserById(userId, { ban_duration: "8760h" }); // 1 year
  } catch (err) {
    logError("softDeleteUser: auth ban failed", err, { tag: "admin-users" });
  }

  // If the deleted user was a teacher, archive the teacher_profiles row too.
  if (existing.role === "teacher") {
    const { error: archiveErr } = await admin.from("teacher_profiles").update({
      is_archived: true,
      archived_at: now,
    } satisfies TableUpdate<"teacher_profiles">).eq("teacher_id", userId);
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
  } satisfies TableInsert<"audit_log">).then((r) => {
    if (r.error) logError("softDeleteUser: audit row failed", r.error, { tag: "admin-users" });
  });

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
  } satisfies TableUpdate<"profiles">).eq("id", userId);

  if (profileErr) return { error: "فشل استعادة المستخدم" };

  try {
    await admin.auth.admin.updateUserById(userId, { ban_duration: "none" });
  } catch (err) {
    logError("restoreUser: auth unban failed", err, { tag: "admin-users" });
  }

  if (existing.role === "teacher") {
    const { error: unarchiveErr } = await admin.from("teacher_profiles").update({
      is_archived: false,
      archived_at: null,
    } satisfies TableUpdate<"teacher_profiles">).eq("teacher_id", userId);
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
  } satisfies TableInsert<"audit_log">).then((r) => {
    if (r.error) logError("restoreUser: audit row failed", r.error, { tag: "admin-users" });
  });

  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${userId}`);
  if (existing.role === "teacher") revalidatePath("/admin/teachers");

  return { success: true };
}

/**
 * Permanently delete a user from auth + cascade through public.profiles
 * and downstream FK-linked tables. IRREVERSIBLE — no restore path.
 *
 * Only allowed on users that are already soft-deleted (deleted_at IS NOT NULL).
 * This makes hard delete a deliberate two-step action: archive first, then
 * after a cooling-off period (or a separate confirm), erase. Reduces blast
 * radius from accidental clicks.
 *
 * Requires the caller to pass the exact `full_name` of the target as
 * confirmation — typed in the UI. Prevents one-click destructive accidents.
 *
 * Self-protection: an admin cannot hard-delete their own account.
 *
 * Audit: a snapshot of the user is written to audit_log BEFORE the delete,
 * because after deletion the record_id is gone and we lose the chain of
 * custody. The audit row is the only paper trail.
 */
export async function hardDeleteUser(userId: string, nameConfirmation: string) {
  const auth = await authOrError();
  if (auth.error) return { error: auth.error };
  if (auth.id === userId) return { error: "لا يمكنك حذف حسابك الخاص" };

  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("profiles")
    .select("role, full_name, deleted_at, is_active, created_at")
    .eq("id", userId)
    .single<{
      role: string;
      full_name: string | null;
      deleted_at: string | null;
      is_active: boolean;
      created_at: string;
    }>();

  if (!existing) return { error: "المستخدم غير موجود" };
  if (!existing.deleted_at) {
    return { error: "يجب أرشفة المستخدم أولاً قبل الحذف النهائي" };
  }

  // Strict equality on the typed name — case- and whitespace-sensitive.
  // Stops "yes" or empty input from sliding through.
  const expected = (existing.full_name ?? "").trim();
  if (expected.length === 0 || nameConfirmation.trim() !== expected) {
    return { error: "اكتب اسم المستخدم بالضبط لتأكيد الحذف النهائي" };
  }

  // Snapshot to audit log BEFORE delete — after, the record is unreachable.
  await admin
    .from("audit_log")
    .insert({
      changed_by: auth.id,
      table_name: "profiles",
      record_id: userId,
      action: "DELETE",
      old_data: {
        role: existing.role,
        full_name: existing.full_name,
        is_active: existing.is_active,
        deleted_at: existing.deleted_at,
        created_at: existing.created_at,
      },
      new_data: null,
      reason: `Hard delete (permanent erase) of ${existing.role}: ${existing.full_name ?? "[no name]"}`,
    } satisfies TableInsert<"audit_log">)
    .then((r) => {
      if (r.error) logError("hardDeleteUser: audit row failed", r.error, { tag: "admin-users" });
    });

  // Supabase Auth handles the auth.users row + cascades via FKs into
  // public.profiles and downstream tables (sessions, bookings, etc).
  // If a RESTRICT FK blocks the delete, the API surfaces the error and
  // we report it back so the operator can clean up references first.
  const { error: authErr } = await admin.auth.admin.deleteUser(userId);
  if (authErr) {
    logError("hardDeleteUser: auth.deleteUser failed", authErr, {
      component: "admin.users.hardDelete",
      tag: "admin-users",
      severity: "critical",
      metadata: { userId, role: existing.role },
    });
    return { error: `تعذر الحذف النهائي: ${authErr.message}` };
  }

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

  if (!["student", "teacher"].includes(role)) {
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
    role: role as UserRole,
    full_name,
    phone,
    country,
    parent_name,
    parent_phone,
    parent_email,
    date_of_birth,
  } satisfies TableUpdate<"profiles">).eq("id", userId);

  if (profileError) {
    return { error: "تم إنشاء المستخدم لكن فشل تحديث الملف الشخصي" };
  }

  if (role === "teacher") {
    // Admin-created teachers are pre-vetted off-platform — go straight to
    // approved so they appear on /teachers immediately. Self-applied
    // teachers via /teach-with-us/apply still land in pending_review for review.
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
    } satisfies TableInsert<"teacher_profiles">);
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
  } satisfies TableInsert<"audit_log">).then((r) => {
    if (r.error) logError("createUserFromScratch: audit row failed", r.error, { tag: "admin-users" });
  });

  revalidatePath("/admin/users");
  return { success: true };
}
