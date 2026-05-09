"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import type { TableInsert, TableUpdate } from "@/lib/supabase/typed-helpers";
import { requireAdmin, ForbiddenError } from "@/lib/auth/require-admin";
import { invalidateRoleCache } from "@/lib/auth/role-cache";
import { logError } from "@/lib/logger";
import { loudAction } from "@/lib/actions/loud";

// Tagged error for "user-mistake-not-infra-fault" throws (not-admin,
// self-deletion, missing user, missing required input). loudAction
// records audit_log marked FAILED for these but Sentry queries can
// filter via tag = "user-error" to keep noise out of infra dashboards.
class UserError extends Error {
  readonly userError = true;
  constructor(msg: string, options?: { cause?: unknown }) { super(msg, options); this.name = "UserError"; }
}

type ActionResult = { error?: string; success?: boolean };

type UserRole = "student" | "teacher" | "admin";
const ALL_ROLES: ReadonlyArray<UserRole> = ["student", "teacher", "admin"];

// Shared admin preflight. Throws UserError on rejection so loudAction
// records audit_log + Sentry breadcrumb without firing Telegram.
async function adminPreflight(): Promise<{ actorId: string }> {
  try {
    const { id } = await requireAdmin();
    return { actorId: id };
  } catch (e) {
    if (e instanceof ForbiddenError) throw new UserError("ليس لديك صلاحية");
    throw e;
  }
}

// ─── toggleUserActive ────────────────────────────────────────────────────────
const toggleUserActiveSchema = z.object({
  userId: z.string().uuid(),
  isActive: z.boolean(),
});

const toggleUserActiveBase = loudAction<z.infer<typeof toggleUserActiveSchema>, { message: string }>({
  name: "admin.users.toggle-active",
  severity: "warning",
  schema: toggleUserActiveSchema,
  audit: { table: "profiles", recordId: (i) => i.userId, action: "UPDATE" },
  preflight: adminPreflight,
  handler: async ({ userId, isActive }, { actorId }) => {
    const admin = createAdminClient();

    // Snapshot existing state for the diff audit row (loudAction's envelope
    // audit only carries the input, not the old value). The diff row's
    // {old_data, new_data} is the source of truth for "what changed."
    const { data: existing } = await admin
      .from("profiles")
      .select("is_active")
      .eq("id", userId)
      .single<{ is_active: boolean }>();

    const { error } = await admin
      .from("profiles")
      .update({ is_active: isActive } satisfies TableUpdate<"profiles">)
      .eq("id", userId);
    if (error) throw error;

    // Diff audit row — captures old/new state. Distinct from loudAction's
    // envelope row which records "attempt + outcome" without state diff.
    await admin.from("audit_log").insert({
      changed_by: actorId,
      table_name: "profiles",
      record_id: userId,
      action: "UPDATE",
      old_data: { is_active: existing?.is_active ?? null },
      new_data: { is_active: isActive },
      reason: isActive ? "Admin reactivated user" : "Admin deactivated user",
    } satisfies TableInsert<"audit_log">).then((r) => {
      if (r.error) logError("toggleUserActive: diff audit row failed", r.error, { tag: "admin-users" });
    });

    revalidatePath("/admin/users");

    return { message: isActive ? "تم تفعيل المستخدم" : "تم تعطيل المستخدم" };
  },
});

export async function toggleUserActive(userId: string, isActive: boolean): Promise<ActionResult> {
  const result = await toggleUserActiveBase({ userId, isActive });
  if (!result.ok) return { error: result.error };
  return { success: true };
}

// ─── setUserRoles ────────────────────────────────────────────────────────────
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
const setUserRolesSchema = z.object({
  userId: z.string().uuid(),
  roles: z.array(z.string()),
});

const setUserRolesBase = loudAction<z.infer<typeof setUserRolesSchema>, { message: string }>({
  name: "admin.users.set-roles",
  severity: "warning",
  schema: setUserRolesSchema,
  audit: { table: "profiles", recordId: (i) => i.userId, action: "UPDATE" },
  preflight: adminPreflight,
  handler: async ({ userId, roles }, { actorId }) => {
    // Dedupe + validate. Empty set is rejected (a user with zero roles
    // would be locked out and the CHECK constraint would refuse the write).
    const dedup = Array.from(new Set(roles)) as UserRole[];
    if (dedup.length === 0) throw new UserError("يجب اختيار دور واحد على الأقل");
    for (const r of dedup) {
      if (!ALL_ROLES.includes(r)) throw new UserError(`دور غير صالح: ${r}`);
    }

    const admin = createAdminClient();

    const { data: existing } = await admin
      .from("profiles")
      .select("role, roles")
      .eq("id", userId)
      .single<{ role: UserRole; roles: UserRole[] | null }>();
    if (!existing) throw new UserError("المستخدم غير موجود");

    const oldRoles = existing.roles ?? [existing.role];
    const oldActive = existing.role;
    // Keep the user's active role if it's still in the new set, otherwise
    // pick the first role of the new set so the CHECK constraint holds.
    const newActive: UserRole = dedup.includes(oldActive) ? oldActive : dedup[0];

    const { error } = await admin
      .from("profiles")
      .update({ roles: dedup, role: newActive } satisfies TableUpdate<"profiles">)
      .eq("id", userId);
    if (error) throw error;

    invalidateRoleCache(userId);

    await admin.from("audit_log").insert({
      changed_by: actorId,
      table_name: "profiles",
      record_id: userId,
      action: "UPDATE",
      old_data: { role: oldActive, roles: oldRoles },
      new_data: { role: newActive, roles: dedup },
      reason: `Admin set roles: [${oldRoles.join(",")}] → [${dedup.join(",")}]`,
    } satisfies TableInsert<"audit_log">).then((r) => {
      if (r.error) logError("setUserRoles: diff audit row failed", r.error, { tag: "admin-users" });
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
      const { error: archiveErr } = await admin
        .from("teacher_profiles")
        .update({
          is_archived: true,
          archived_at: new Date().toISOString(),
        } satisfies TableUpdate<"teacher_profiles">)
        .eq("teacher_id", userId);
      if (archiveErr) {
        logError("setUserRoles: teacher_profiles auto-archive failed", archiveErr, { tag: "admin-users" });
      }
    }

    revalidatePath("/admin/users");
    revalidatePath(`/admin/users/${userId}`);
    revalidatePath("/admin/teachers");

    return { message: "تم تحديث الأدوار" };
  },
});

export async function setUserRoles(userId: string, roles: string[]): Promise<ActionResult> {
  const result = await setUserRolesBase({ userId, roles });
  if (!result.ok) return { error: result.error };
  return { success: true };
}

/**
 * Legacy single-role mutator. Kept as a thin wrapper around `setUserRoles`
 * so existing call sites keep working until they migrate to multi-select.
 * Equivalent to "the user's only role is now X."
 */
export async function changeUserRole(userId: string, role: string): Promise<ActionResult> {
  return setUserRoles(userId, [role]);
}

// ─── softDeleteUser ──────────────────────────────────────────────────────────
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
const softDeleteUserSchema = z.object({
  userId: z.string().uuid(),
  reason: z.string(),
});

const softDeleteUserBase = loudAction<z.infer<typeof softDeleteUserSchema>, { message: string }>({
  name: "admin.users.soft-delete",
  severity: "warning",
  schema: softDeleteUserSchema,
  audit: { table: "profiles", recordId: (i) => i.userId, action: "DELETE" },
  preflight: adminPreflight,
  handler: async ({ userId, reason }, { actorId }) => {
    if (actorId === userId) throw new UserError("لا يمكنك حذف حسابك الخاص");

    const trimmed = (reason ?? "").trim();
    if (trimmed.length < 3) throw new UserError("يرجى إدخال سبب واضح للحذف");

    const admin = createAdminClient();

    const { data: existing } = await admin
      .from("profiles")
      .select("role, full_name, is_active, deleted_at")
      .eq("id", userId)
      .single<{ role: string; full_name: string | null; is_active: boolean; deleted_at: string | null }>();

    if (!existing) throw new UserError("المستخدم غير موجود");
    if (existing.deleted_at) throw new UserError("المستخدم محذوف بالفعل");

    const now = new Date().toISOString();

    const { error: profileErr } = await admin
      .from("profiles")
      .update({
        is_active: false,
        deleted_at: now,
      } satisfies TableUpdate<"profiles">)
      .eq("id", userId);

    if (profileErr) throw profileErr;

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
      const { error: archiveErr } = await admin
        .from("teacher_profiles")
        .update({
          is_archived: true,
          archived_at: now,
        } satisfies TableUpdate<"teacher_profiles">)
        .eq("teacher_id", userId);
      if (archiveErr) logError("softDeleteUser: teacher_profiles archive failed", archiveErr, { tag: "admin-users" });
    }

    await admin.from("audit_log").insert({
      changed_by: actorId,
      table_name: "profiles",
      record_id: userId,
      action: "DELETE",
      old_data: { is_active: existing.is_active, deleted_at: null },
      new_data: { is_active: false, deleted_at: now },
      reason: `Admin soft-deleted user (${existing.role}): ${trimmed}`,
    } satisfies TableInsert<"audit_log">).then((r) => {
      if (r.error) logError("softDeleteUser: diff audit row failed", r.error, { tag: "admin-users" });
    });

    revalidatePath("/admin/users");
    revalidatePath(`/admin/users/${userId}`);
    if (existing.role === "teacher") revalidatePath("/admin/teachers");

    return { message: "تم حذف المستخدم" };
  },
});

export async function softDeleteUser(userId: string, reason: string): Promise<ActionResult> {
  const result = await softDeleteUserBase({ userId, reason });
  if (!result.ok) return { error: result.error };
  return { success: true };
}

// ─── restoreUser ─────────────────────────────────────────────────────────────
/**
 * Reverse softDeleteUser. Clears deleted_at, sets is_active=true, lifts ban.
 */
const restoreUserSchema = z.object({ userId: z.string().uuid() });

const restoreUserBase = loudAction<z.infer<typeof restoreUserSchema>, { message: string }>({
  name: "admin.users.restore",
  severity: "warning",
  schema: restoreUserSchema,
  audit: { table: "profiles", recordId: (i) => i.userId, action: "UPDATE" },
  preflight: adminPreflight,
  handler: async ({ userId }, { actorId }) => {
    const admin = createAdminClient();

    const { data: existing } = await admin
      .from("profiles")
      .select("role, deleted_at")
      .eq("id", userId)
      .single<{ role: string; deleted_at: string | null }>();

    if (!existing) throw new UserError("المستخدم غير موجود");
    if (!existing.deleted_at) throw new UserError("المستخدم ليس محذوفاً");

    const { error: profileErr } = await admin
      .from("profiles")
      .update({
        is_active: true,
        deleted_at: null,
      } satisfies TableUpdate<"profiles">)
      .eq("id", userId);

    if (profileErr) throw profileErr;

    try {
      await admin.auth.admin.updateUserById(userId, { ban_duration: "none" });
    } catch (err) {
      logError("restoreUser: auth unban failed", err, { tag: "admin-users" });
    }

    if (existing.role === "teacher") {
      const { error: unarchiveErr } = await admin
        .from("teacher_profiles")
        .update({
          is_archived: false,
          archived_at: null,
        } satisfies TableUpdate<"teacher_profiles">)
        .eq("teacher_id", userId);
      if (unarchiveErr) logError("restoreUser: teacher_profiles unarchive failed", unarchiveErr, { tag: "admin-users" });
    }

    await admin.from("audit_log").insert({
      changed_by: actorId,
      table_name: "profiles",
      record_id: userId,
      action: "UPDATE",
      old_data: { is_active: false, deleted_at: existing.deleted_at },
      new_data: { is_active: true, deleted_at: null },
      reason: "Admin restored deleted user",
    } satisfies TableInsert<"audit_log">).then((r) => {
      if (r.error) logError("restoreUser: diff audit row failed", r.error, { tag: "admin-users" });
    });

    revalidatePath("/admin/users");
    revalidatePath(`/admin/users/${userId}`);
    if (existing.role === "teacher") revalidatePath("/admin/teachers");

    return { message: "تم استعادة المستخدم" };
  },
});

export async function restoreUser(userId: string): Promise<ActionResult> {
  const result = await restoreUserBase({ userId });
  if (!result.ok) return { error: result.error };
  return { success: true };
}

// ─── hardDeleteUser ──────────────────────────────────────────────────────────
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
 *
 * severity: critical fires Telegram alert if the auth.deleteUser cascade
 * fails — the operator needs to know immediately so they can clean up
 * dangling FK references manually.
 */
const hardDeleteUserSchema = z.object({
  userId: z.string().uuid(),
  nameConfirmation: z.string(),
});

const hardDeleteUserBase = loudAction<z.infer<typeof hardDeleteUserSchema>, { message: string }>({
  name: "admin.users.hard-delete",
  severity: "critical",
  schema: hardDeleteUserSchema,
  audit: { table: "profiles", recordId: (i) => i.userId, action: "DELETE" },
  preflight: adminPreflight,
  handler: async ({ userId, nameConfirmation }, { actorId }) => {
    if (actorId === userId) throw new UserError("لا يمكنك حذف حسابك الخاص");

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

    if (!existing) throw new UserError("المستخدم غير موجود");
    if (!existing.deleted_at) {
      throw new UserError("يجب أرشفة المستخدم أولاً قبل الحذف النهائي");
    }

    // Strict equality on the typed name — case- and whitespace-sensitive.
    // Stops "yes" or empty input from sliding through.
    const expected = (existing.full_name ?? "").trim();
    if (expected.length === 0 || nameConfirmation.trim() !== expected) {
      throw new UserError("اكتب اسم المستخدم بالضبط لتأكيد الحذف النهائي");
    }

    // Snapshot to audit log BEFORE delete — after, the record is unreachable.
    // This is distinct from loudAction's envelope audit (which fires via
    // after() post-response). The diff row carries the full pre-delete state;
    // the envelope row records "attempt + outcome" without state.
    await admin
      .from("audit_log")
      .insert({
        changed_by: actorId,
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
        if (r.error) logError("hardDeleteUser: pre-delete diff audit row failed", r.error, { tag: "admin-users" });
      });

    // Supabase Auth handles the auth.users row + cascades via FKs into
    // public.profiles and downstream tables (sessions, bookings, etc).
    // If a RESTRICT FK blocks the delete, the API surfaces the error and
    // we throw so loudAction logs critical + fires Telegram.
    const { error: authErr } = await admin.auth.admin.deleteUser(userId);
    if (authErr) {
      logError("hardDeleteUser: auth.deleteUser failed", authErr, {
        component: "admin.users.hardDelete",
        tag: "admin-users",
        severity: "critical",
        metadata: { userId, role: existing.role },
      });
      throw new Error(`تعذر الحذف النهائي: ${authErr.message}`);
    }

    revalidatePath("/admin/users");
    revalidatePath(`/admin/users/${userId}`);
    if (existing.role === "teacher") revalidatePath("/admin/teachers");

    return { message: "تم الحذف النهائي" };
  },
});

export async function hardDeleteUser(userId: string, nameConfirmation: string): Promise<ActionResult> {
  const result = await hardDeleteUserBase({ userId, nameConfirmation });
  if (!result.ok) return { error: result.error };
  return { success: true };
}

// ─── createUserFromScratch ───────────────────────────────────────────────────
const createUserSchema = z.object({
  email: z.string().email("البريد الإلكتروني غير صالح"),
  password: z.string().min(8, "كلمة المرور يجب أن تكون 8 أحرف على الأقل"),
  full_name: z.string().min(1, "الاسم الكامل مطلوب"),
  role: z.enum(["student", "teacher"], { message: "دور غير صالح" }),
  phone: z.string().nullable(),
  country: z.string().nullable(),
  parent_name: z.string().nullable(),
  parent_phone: z.string().nullable(),
  parent_email: z.string().nullable(),
  date_of_birth: z.string().nullable(),
});

const createUserFromScratchBase = loudAction<z.infer<typeof createUserSchema>, { message: string }>({
  name: "admin.users.create-from-scratch",
  severity: "warning",
  schema: createUserSchema,
  // recordId resolved post-creation; the diff audit row written below
  // carries the real userId once auth.admin.createUser returns it. The
  // envelope row records "Admin attempted to create user with email X"
  // even when the auth.users insert fails, which is useful security
  // telemetry on its own (failed createUser attempts can indicate
  // credential-stuffing against the admin panel).
  audit: { table: "profiles", recordId: () => "pending", action: "INSERT" },
  preflight: adminPreflight,
  handler: async (input, { actorId }) => {
    const adminClient = createAdminClient();

    const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
      email: input.email,
      password: input.password,
      email_confirm: true,
      user_metadata: { full_name: input.full_name },
    });

    if (authError || !authData.user) {
      if (authError?.message?.includes("already been registered")) {
        throw new UserError("البريد الإلكتروني مسجل بالفعل");
      }
      throw new Error(authError?.message ?? "فشل إنشاء المستخدم");
    }

    const userId = authData.user.id;

    // Both `role` (scalar) AND `roles[]` (array) must transition together to
    // satisfy `profiles_active_role_in_set` CHECK (`role = ANY(roles)`,
    // migration 20260501173121). The trigger-created profile starts with
    // `roles=['student']`; if the admin is creating a teacher or admin we
    // must overwrite both columns or the UPDATE rejects. Same fix as
    // /teach-with-us/apply (2026-05-09).
    const { data: profileUpd, error: profileError } = await adminClient
      .from("profiles")
      .update({
        role: input.role as UserRole,
        roles: [input.role as UserRole],
        full_name: input.full_name,
        phone: input.phone,
        country: input.country,
        parent_name: input.parent_name,
        parent_phone: input.parent_phone,
        parent_email: input.parent_email,
        date_of_birth: input.date_of_birth,
      } satisfies TableUpdate<"profiles">)
      .eq("id", userId)
      .select("id");

    if (profileError || !profileUpd || profileUpd.length === 0) {
      throw new Error("تم إنشاء المستخدم لكن فشل تحديث الملف الشخصي");
    }

    if (input.role === "teacher") {
      // Admin-created teachers are pre-vetted off-platform — go straight to
      // approved so they appear on /teachers immediately. Self-applied
      // teachers via /teach-with-us/apply still land in pending_review.
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
        throw new Error(`تم إنشاء الحساب لكن فشل إنشاء ملف المعلم: ${tpError.message}`);
      }
    }

    // Diff audit with the real userId now that auth.admin.createUser returned it.
    await adminClient.from("audit_log").insert({
      changed_by: actorId,
      table_name: "profiles",
      record_id: userId,
      action: "INSERT",
      old_data: null,
      new_data: { email: input.email, role: input.role, full_name: input.full_name, country: input.country },
      reason: `Admin created ${input.role} account`,
    } satisfies TableInsert<"audit_log">).then((r) => {
      if (r.error) logError("createUserFromScratch: diff audit row failed", r.error, { tag: "admin-users" });
    });

    revalidatePath("/admin/users");

    return { message: "تم إنشاء المستخدم" };
  },
});

export async function createUserFromScratch(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const result = await createUserFromScratchBase({
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
    full_name: String(formData.get("full_name") ?? ""),
    role: String(formData.get("role") ?? "") as "student" | "teacher",
    phone: (formData.get("phone") as string) || null,
    country: (formData.get("country") as string) || null,
    parent_name: (formData.get("parent_name") as string) || null,
    parent_phone: (formData.get("parent_phone") as string) || null,
    parent_email: (formData.get("parent_email") as string) || null,
    date_of_birth: (formData.get("date_of_birth") as string) || null,
  });
  if (!result.ok) return { error: result.error };
  return { success: true };
}
