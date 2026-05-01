"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logError } from "@/lib/logger";
import type { TableInsert, TableUpdate } from "@/lib/supabase/typed-helpers";
import type { SessionType, BookingStatus } from "@/types/database";

/**
 * Phase 1 of group lessons — ad-hoc add-student.
 *
 * The teacher (or an admin) can attach a second/third/Nth student to a
 * session that already exists for an earlier 1:1 booking. Each enrolled
 * student gets their OWN bookings row (so per-student concepts — homework,
 * evaluation, package credit, payment — keep their existing semantics).
 *
 * Steps:
 *   1. Permission gate: caller is the session's teacher OR an admin.
 *   2. Idempotency: the same student can't be added twice to one session.
 *   3. Inherit slot details from the primary booking (sessions.booking_id).
 *   4. Insert the new student's bookings row, status='confirmed', linked to
 *      both the session and the inherited teacher.
 *   5. Deduct one credit from the new student's package via the existing
 *      `deduct_package_session(uuid)` SQL function. If they have no active
 *      package, the booking is still created but flagged via `notes` so an
 *      admin can reconcile billing later.
 *   6. Bump session.is_group=true and session.capacity to fit the new count.
 *   7. Audit log + cache revalidation.
 */
export async function addStudentToSession(
  sessionId: string,
  studentId: string,
): Promise<{ success?: true; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "غير مصرح" };

  // Permission probe via the user-context client first — this respects RLS
  // and tells us whether the caller is the session's teacher OR an admin
  // without needing to know their role here.
  const { data: session, error: sessionErr } = await supabase
    .from("sessions")
    .select("id, booking_id, capacity, is_group")
    .eq("id", sessionId)
    .single<{ id: string; booking_id: string; capacity: number; is_group: boolean }>();
  if (sessionErr || !session) return { error: "الجلسة غير موجودة أو لا تملك صلاحية الوصول" };

  // Inherit slot from the primary booking — admin client to bypass RLS so
  // we can read across student-scoped policies if the caller is the teacher.
  const admin = createAdminClient();
  const { data: primary } = await admin
    .from("bookings")
    .select("teacher_id, scheduled_at, duration_min, session_type, amount_usd, amount_local, local_currency, exchange_rate, rate_snapshot, tax_amount, tax_rate")
    .eq("id", session.booking_id)
    .single<{
      teacher_id: string; scheduled_at: string; duration_min: number;
      session_type: SessionType; amount_usd: number; amount_local: number | null;
      local_currency: string | null; exchange_rate: number | null;
      rate_snapshot: number; tax_amount: number; tax_rate: number;
    }>();
  if (!primary) return { error: "لم يتم العثور على الحجز الأساسي للجلسة" };

  // Authorisation: the caller must be the teacher of this session, or
  // an admin. Reading their profile.role (active role) is sufficient
  // because /admin/* and /teacher/* routes both gate active role.
  const { data: callerProfile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single<{ role: string }>();
  const isOwningTeacher = primary.teacher_id === user.id;
  const isAdmin = callerProfile?.role === "admin";
  if (!isOwningTeacher && !isAdmin) {
    return { error: "ليس لديك صلاحية إضافة طلاب لهذه الجلسة" };
  }

  // Sanity: the new student must exist and not already be in this session.
  const { data: studentProfile } = await admin
    .from("profiles")
    .select("id, role, full_name")
    .eq("id", studentId)
    .single<{ id: string; role: string; full_name: string | null }>();
  if (!studentProfile) return { error: "الطالب غير موجود" };
  if (!studentProfile.role || (Array.isArray(studentProfile.role) ? !studentProfile.role.includes("student") : studentProfile.role !== "student")) {
    // Allow multi-role users who hold "student" in their roles[]. We only
    // have role (active) here; if it's not student, fall through and check
    // roles[] explicitly.
    const { data: rolesRow } = await admin
      .from("profiles")
      .select("roles")
      .eq("id", studentId)
      .single<{ roles: string[] | null }>();
    const holdsStudent = rolesRow?.roles?.includes("student") ?? false;
    if (!holdsStudent) return { error: "الحساب المختار ليس طالباً" };
  }

  const { data: alreadyEnrolled } = await admin
    .from("bookings")
    .select("id")
    .eq("session_id", sessionId)
    .eq("student_id", studentId)
    .maybeSingle();
  if (alreadyEnrolled) return { error: "هذا الطالب مُسجَّل بالفعل في الجلسة" };

  // Capacity check: count current enrollees and reject if at limit.
  const { count: enrolledCount } = await admin
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("session_id", sessionId);
  const currentEnrolled = enrolledCount ?? 0;
  if (currentEnrolled >= session.capacity && currentEnrolled >= 20) {
    return { error: "وصلت الجلسة للحد الأقصى للطلاب" };
  }

  // Try to deduct a package credit. Failure here doesn't block the booking
  // — the session is still created and the operator can reconcile billing
  // out-of-band. We capture which path was taken in the booking notes.
  // The SQL function takes a package id (not a student id), so first find
  // the student's active package with credits remaining.
  let creditNote = "";
  let studentPackageId: string | null = null;
  const { data: activePkg } = await admin
    .from("student_packages")
    .select("id, sessions_remaining")
    .eq("student_id", studentId)
    .eq("status", "active")
    .gt("sessions_remaining", 0)
    .order("expires_at", { ascending: true, nullsFirst: false })
    .limit(1)
    .maybeSingle<{ id: string; sessions_remaining: number }>();

  if (activePkg) {
    studentPackageId = activePkg.id;
    try {
      const { error: deductErr } = await admin.rpc("deduct_package_session", { p_package_id: activePkg.id });
      if (deductErr) creditNote = `[deduct-failed: ${deductErr.message}] `;
    } catch (e) {
      creditNote = "[deduct-threw] ";
      logError("addStudentToSession: deduct_package_session call failed", e, {
        tag: "group-session", metadata: { sessionId, studentId, packageId: activePkg.id },
      });
    }
  } else {
    creditNote = "[no-active-package] ";
  }

  const newAmount = primary.amount_usd; // each student pays full price
  const { data: newBooking, error: insertErr } = await admin
    .from("bookings")
    .insert({
      student_id: studentId,
      teacher_id: primary.teacher_id,
      scheduled_at: primary.scheduled_at,
      duration_min: primary.duration_min,
      session_type: primary.session_type,
      amount_usd: newAmount,
      amount_local: primary.amount_local,
      local_currency: primary.local_currency,
      exchange_rate: primary.exchange_rate,
      rate_snapshot: primary.rate_snapshot,
      tax_amount: primary.tax_amount,
      tax_rate: primary.tax_rate,
      status: "confirmed" as BookingStatus,
      teacher_confirmed: true,
      teacher_confirmed_at: new Date().toISOString(),
      created_by: user.id,
      session_id: sessionId,
      student_package_id: studentPackageId,
      notes: `${creditNote}Added to existing session ${sessionId.slice(0, 8)} by ${isAdmin ? "admin" : "teacher"} ${user.id.slice(0, 8)}`,
    } satisfies TableInsert<"bookings">)
    .select("id")
    .single<{ id: string }>();

  if (insertErr || !newBooking) {
    logError("addStudentToSession: bookings insert failed", insertErr, {
      tag: "group-session", metadata: { sessionId, studentId },
    });
    return { error: "فشل إنشاء الحجز للطالب" };
  }

  // Promote the session to group + grow capacity if needed.
  const newEnrolledCount = currentEnrolled + 1;
  const newCapacity = Math.max(session.capacity, newEnrolledCount);
  if (!session.is_group || session.capacity < newCapacity) {
    const { error: sessionUpdateErr } = await admin
      .from("sessions")
      .update({
        is_group: true,
        capacity: newCapacity,
      } satisfies TableUpdate<"sessions">)
      .eq("id", sessionId);
    if (sessionUpdateErr) {
      logError("addStudentToSession: session bump failed", sessionUpdateErr, {
        tag: "group-session", metadata: { sessionId, newCapacity },
      });
      // Non-fatal — the booking is in; admin can patch session row manually.
    }
  }

  // Resize the Daily.co room so the new student can actually join the call.
  // Default rooms are sized for 1:1 + observer (3); we need
  // capacity (students) + 1 (teacher) + 1 (admin observer headroom).
  // Failures here are logged but non-fatal — the booking still stands and
  // an admin can resize the room from the Daily dashboard if needed.
  try {
    const { data: roomRow } = await admin
      .from("sessions")
      .select("room_name")
      .eq("id", sessionId)
      .single<{ room_name: string }>();
    if (roomRow?.room_name) {
      const { updateRoomMaxParticipants } = await import("@/lib/daily");
      await updateRoomMaxParticipants(roomRow.room_name, newEnrolledCount + 2);
    }
  } catch (e) {
    logError("addStudentToSession: Daily room resize failed", e, {
      tag: "group-session", metadata: { sessionId, newEnrolledCount },
    });
  }

  await admin.from("audit_log").insert({
    changed_by: user.id,
    table_name: "bookings",
    record_id: newBooking.id,
    action: "INSERT",
    old_data: null,
    new_data: {
      session_id: sessionId,
      student_id: studentId,
      teacher_id: primary.teacher_id,
      via: isAdmin ? "admin.addStudentToSession" : "teacher.addStudentToSession",
    },
    reason: `Added ${studentProfile.full_name ?? studentId.slice(0, 8)} to session ${sessionId.slice(0, 8)}`,
  } satisfies TableInsert<"audit_log">).then((r) => {
    if (r.error) logError("addStudentToSession: audit insert failed", r.error, { tag: "group-session" });
  });

  revalidatePath(`/teacher/sessions/${sessionId}`);
  revalidatePath("/teacher/sessions");
  revalidatePath("/student/dashboard");
  revalidatePath("/student/sessions");
  return { success: true };
}
