import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase.generated";
import { emitEvent } from "@/lib/automation/emit";
import { logError } from "@/lib/logger";

/**
 * Spec 020 — Scheduling, Fixed-Teacher Assignment & Cohorts (US1 / T007).
 *
 * Domain layer for teacher assignments.
 */

export interface Assignment {
  id: string;
  student_id: string;
  teacher_id: string;
  teacher_name?: string;
  teacher_name_ar?: string;
  subscription_id: string;
  product_type: "hifz_individual" | "hifz_group" | "course";
  lock_month: string;
  is_active: boolean;
  approved_by: string | null;
  cancelled_future_bookings_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AssignTeacherInput {
  student_id: string;
  teacher_id: string;
  subscription_id: string;
  product_type: "hifz_individual" | "hifz_group" | "course";
  lock_month: string;
  approved_by?: string;
}

/**
 * Fetch the active teacher assignment for a student.
 * Joins profiles for teacher display names (incl. Arabic for RTL).
 */
export async function getMyAssignment(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<Assignment | null> {
  const { data, error } = await supabase
    .from("subscription_teacher_assignments")
    .select(`
      *,
      teacher:profiles!teacher_id (
        full_name,
        full_name_ar
      )
    `)
    .eq("student_id", userId)
    .eq("is_active", true)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const teacher = Array.isArray(data.teacher) ? data.teacher[0] : data.teacher;

  return {
    ...data,
    product_type: data.product_type as Assignment["product_type"],
    teacher_name: teacher?.full_name ?? undefined,
    teacher_name_ar: teacher?.full_name_ar ?? undefined,
  };
}

/**
 * Create a new teacher assignment. Service-role or admin only.
 * The `uix_sta_student_active` index enforces one active assignment.
 */
export async function createAssignment(
  admin: SupabaseClient<Database>,
  input: AssignTeacherInput,
): Promise<string> {
  const { data, error } = await admin
    .from("subscription_teacher_assignments")
    .insert({
      student_id: input.student_id,
      teacher_id: input.teacher_id,
      subscription_id: input.subscription_id,
      product_type: input.product_type,
      lock_month: input.lock_month,
      approved_by: input.approved_by,
      is_active: true,
    })
    .select("id")
    .single();

  if (error) throw error;

  // Emit assignment.created event (FR-021)
  emitEvent("assignment.created", "assignment", data.id, {
    student_id: input.student_id,
    teacher_id: input.teacher_id,
    product_type: input.product_type,
    lock_month: input.lock_month,
  }, input.approved_by).catch((err) => logError("emit assignment.created failed", err, { tag: "automation" }));

  return data.id;
}

/**
 * Reassign a student to a different teacher (US4 / T021).
 * Admin only. Bulk-cancels future bookings.
 *
 * Delegates to the `reassign_teacher_atomic` SECURITY DEFINER RPC so the
 * assignment update, audit-timestamp write, and future-booking cancellation
 * land in a single Postgres transaction. This closes the silent
 * data-integrity gap where a failed cancel could leave the assignment row
 * showing a `cancelled_future_bookings_at` timestamp while bookings stayed
 * active under the old teacher.
 */
export async function reassignTeacher(
  admin: SupabaseClient<Database>,
  assignmentId: string,
  newTeacherId: string,
  reason: string,
  adminId: string,
): Promise<{ ok: true; cancellationCount: number }> {
  const { data, error } = await admin.rpc("reassign_teacher_atomic", {
    p_assignment_id: assignmentId,
    p_new_teacher_id: newTeacherId,
    p_admin_id: adminId,
  });

  if (error) {
    // P0002 (no_data_found) from SELECT INTO STRICT — assignment missing.
    // Surface the underlying DB error verbatim; the caller is responsible
    // for mapping known codes to HTTP responses.
    throw error;
  }

  // RPC returns TABLE(student_id uuid, cancellation_count int); Supabase
  // types it as an array of rows. We expect exactly one row.
  const resultRow = (data as unknown as Array<{ student_id: string; cancellation_count: number }>)[0];
  const cancellationCount = resultRow?.cancellation_count ?? 0;

  // Emit assignment.changed event (FR-021)
  emitEvent("assignment.changed", "assignment", assignmentId, {
    student_id: resultRow?.student_id,
    teacher_id: newTeacherId,
    reason,
    cancellations: cancellationCount,
  }, adminId).catch((err) => logError("emit assignment.changed failed", err, { tag: "automation" }));

  return { ok: true, cancellationCount };
}

/**
 * Fetch a student's full assignment history (US5 / T024). Admin only.
 */
export async function getStudentAssignmentHistory(
  admin: SupabaseClient<Database>,
  studentId: string,
): Promise<Assignment[]> {
  const { data, error } = await admin
    .from("subscription_teacher_assignments")
    .select(`
      *,
      teacher:profiles!teacher_id (
        full_name,
        full_name_ar
      )
    `)
    .eq("student_id", studentId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  if (!data) return [];

  return data.map((row) => {
    const teacher = Array.isArray(row.teacher) ? row.teacher[0] : row.teacher;
    return {
      ...row,
      product_type: row.product_type as Assignment["product_type"],
      teacher_name: teacher?.full_name ?? undefined,
      teacher_name_ar: teacher?.full_name_ar ?? undefined,
    };
  });
}
