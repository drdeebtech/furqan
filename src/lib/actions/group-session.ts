"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logError } from "@/lib/logger";
import { loudAction, notFoundOrInfra } from "@/lib/actions/loud";
import { selectActivePackage, debitPackage } from "@/lib/domains/package/ledger";
import type { TableInsert, TableUpdate } from "@/lib/supabase/typed-helpers";
import type { SessionType, BookingStatus } from "@/types/database";

class UserError extends Error {
  readonly userError = true;
  constructor(msg: string, options?: { cause?: unknown }) {
    super(msg, options);
    this.name = "UserError";
  }
}

/**
 * Phase 1 of group lessons — ad-hoc add-student.
 *
 * The teacher (or an admin) can attach a second/third/Nth student to a
 * session that already exists for an earlier 1:1 booking. Each enrolled
 * student gets their OWN bookings row (so per-student concepts — follow-up,
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
 *   7. Daily.co room resize (best-effort).
 *   8. Diff audit row preserved (captures the cascade detail that the
 *      framework's generic audit can't), in addition to the framework's
 *      audit_log row.
 */
type AddStudentInput = { sessionId: string; studentId: string };

const addStudentToSessionBase = loudAction<AddStudentInput, { message: string }>({
  name: "group-session.add-student",
  // P1 multi-side-effect: bookings row, package credit, session bump, Daily
  // resize, and audit row. info severity matches other multi-write wraps in
  // homework.ts (e.g. gradeHomework's auto-regen branch).
  severity: "info",
  audit: {
    table: "bookings",
    recordId: (i) => i.sessionId,
    action: "INSERT",
    reasonPrefix: "add student to group session",
  },
  preflight: async () => {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new UserError("غير مصرح");
    return { actorId: user.id };
  },
  handler: async ({ sessionId, studentId }, { actorId }) => {
    const supabase = await createClient();

    // Permission probe via the user-context client first — this respects RLS
    // and tells us whether the caller is the session's teacher OR an admin
    // without needing to know their role here.
    const { data: session, error: sessionErr } = await supabase
      .from("sessions")
      .select("id, booking_id, capacity, is_group")
      .eq("id", sessionId)
      .single<{ id: string; booking_id: string; capacity: number; is_group: boolean }>();
    if (sessionErr || !session) throw notFoundOrInfra(sessionErr, "الجلسة غير موجودة أو لا تملك صلاحية الوصول");

    // Inherit slot from the primary booking — admin client to bypass RLS so
    // we can read across student-scoped policies if the caller is the teacher.
    const admin = createAdminClient();
    const { data: primary, error: primaryErr } = await admin
      .from("bookings")
      .select("teacher_id, scheduled_at, duration_min, session_type, amount_usd, amount_local, local_currency, exchange_rate, rate_snapshot, tax_amount, tax_rate")
      .eq("id", session.booking_id)
      .single<{
        teacher_id: string; scheduled_at: string; duration_min: number;
        session_type: SessionType; amount_usd: number; amount_local: number | null;
        local_currency: string | null; exchange_rate: number | null;
        rate_snapshot: number; tax_amount: number; tax_rate: number;
      }>();
    if (primaryErr || !primary) throw notFoundOrInfra(primaryErr, "لم يتم العثور على الحجز الأساسي للجلسة");

    // Authorisation: the caller must be the teacher of this session, or
    // an admin. Reading their profile.role (active role) is sufficient
    // because /admin/* and /teacher/* routes both gate active role.
    const { data: callerProfile, error: callerProfileErr } = await admin
      .from("profiles")
      .select("role")
      .eq("id", actorId!)
      .single<{ role: string }>();
    if (callerProfileErr || !callerProfile) throw notFoundOrInfra(callerProfileErr, "غير مصرح");
    const isOwningTeacher = primary.teacher_id === actorId;
    const isAdmin = callerProfile.role === "admin";
    if (!isOwningTeacher && !isAdmin) throw new UserError("ليس لديك صلاحية إضافة طلاب لهذه الجلسة");

    // Sanity: the new student must exist and not already be in this session.
    const { data: studentProfile, error: studentProfileErr } = await admin
      .from("profiles")
      .select("id, role, full_name")
      .eq("id", studentId)
      .single<{ id: string; role: string; full_name: string | null }>();
    if (studentProfileErr || !studentProfile) throw notFoundOrInfra(studentProfileErr, "الطالب غير موجود");
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
      if (!holdsStudent) throw new UserError("الحساب المختار ليس طالباً");
    }

    const { data: alreadyEnrolled, error: alreadyEnrolledErr } = await admin
      .from("bookings")
      .select("id")
      .eq("session_id", sessionId)
      .eq("student_id", studentId)
      .maybeSingle();
    if (alreadyEnrolledErr) throw new UserError("تعذر التحقق من التسجيلات الحالية", { cause: alreadyEnrolledErr });
    if (alreadyEnrolled) throw new UserError("هذا الطالب مُسجَّل بالفعل في الجلسة");

    // Capacity check: count current enrollees and reject if at limit.
    const { count: enrolledCount, error: enrolledCountErr } = await admin
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("session_id", sessionId);
    if (enrolledCountErr) throw new UserError("تعذر حساب عدد الطلاب الحالي", { cause: enrolledCountErr });
    const currentEnrolled = enrolledCount ?? 0;
    // Two independent caps: (1) the per-session capacity, and (2) a
    // platform hard cap of 20. The original combined predicate used
    // `&&`, which fails open if `session.capacity` ever exceeds 20
    // (manual DB edit, future migration, off-by-one). Splitting the
    // checks fails closed in both cases.
    // (Flagged by CodeRabbit on PR #271 review.)
    const PLATFORM_GROUP_CAP = 20;
    if (currentEnrolled >= PLATFORM_GROUP_CAP) {
      throw new UserError("وصلت الجلسة للحد الأقصى للطلاب");
    }
    if (currentEnrolled >= session.capacity) {
      throw new UserError("وصلت الجلسة لسعتها المحددة");
    }

    // Deduct a package credit before creating the booking. A null return from
    // deduct_package_session() means the predicate failed (package expired or
    // exhausted) even though the RPC itself succeeded — callers MUST check data,
    // not just error. Spec 005 FR-002 / T14 / deduct_package_session.md §Return.
    let creditNote = "";
    let studentPackageId: string | null = null;
    const activePkg = await selectActivePackage(admin, studentId);

    if (activePkg) {
      studentPackageId = activePkg.id;
      try {
        const debit = await debitPackage(admin, activePkg.id);
        if (!debit.ok && debit.reason === "error") {
          creditNote = `[deduct-failed: ${debit.message}] `;
          throw new UserError("تعذر خصم رصيد الباقة. حاول مرة أخرى.");
        }
        if (!debit.ok && debit.reason === "exhausted") {
          creditNote = "[package-expired-or-exhausted] ";
          throw new UserError("هذه الباقة منتهية أو مستهلكة ولا يمكن استخدامها لتسجيل الطالب.");
        }
      } catch (e) {
        creditNote = creditNote || "[deduct-threw] ";
        logError("addStudentToSession: deduct_package_session call failed", e, {
          tag: "group-session", metadata: { sessionId, studentId, packageId: activePkg.id },
        });
        throw e;
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
        created_by: actorId!,
        session_id: sessionId,
        student_package_id: studentPackageId,
        notes: `${creditNote}Added to existing session ${sessionId.slice(0, 8)} by ${isAdmin ? "admin" : "teacher"} ${actorId!.slice(0, 8)}`,
      } satisfies TableInsert<"bookings">)
      .select("id")
      .single<{ id: string }>();
    if (insertErr || !newBooking) throw new UserError("فشل إنشاء الحجز للطالب", { cause: insertErr });

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
        // Non-fatal — the booking is in; admin can patch session row manually.
        // Logged loud so ops sees the inconsistency between bookings count
        // and sessions.is_group/capacity.
        logError("addStudentToSession: session bump failed", sessionUpdateErr, {
          tag: "group-session", metadata: { sessionId, newCapacity },
        });
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

    // Diff audit row — preserved alongside the framework's generic audit row.
    // This one carries the cascade detail (session_id, both party ids, route
    // taken). Best-effort: a failed audit insert must NOT fail the action.
    await admin.from("audit_log").insert({
      changed_by: actorId!,
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
    } satisfies TableInsert<"audit_log">).then(
      (r) => {
        if (r.error) logError("addStudentToSession: audit insert failed", r.error, { tag: "group-session" });
      },
      (err: unknown) => {
        // Network/serialization failure before Supabase responded — keep
        // best-effort guarantee by routing through logError instead of
        // surfacing as an unhandled rejection. PostgrestBuilder returns
        // PromiseLike (no .catch), so use the two-arg .then form.
        // (CodeRabbit PR #271.)
        logError("addStudentToSession: audit insert promise rejected", err, { tag: "group-session" });
      },
    );

    revalidatePath(`/teacher/sessions/${sessionId}`);
    revalidatePath("/teacher/sessions");
    revalidatePath("/student/dashboard");
    revalidatePath("/student/sessions");
    return { message: "added" };
  },
});

export async function addStudentToSession(
  sessionId: string,
  studentId: string,
): Promise<{ success?: true; error?: string }> {
  const result = await addStudentToSessionBase({ sessionId, studentId });
  if (!result.ok) return { error: result.error };
  return { success: true };
}
