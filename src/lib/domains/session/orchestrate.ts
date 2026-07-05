import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { callRpc } from "@/lib/supabase/rpc";
import { notify } from "@/lib/notifications/dispatcher";
import {
  notifyParentSessionComplete,
  notifyParentNoShow,
} from "@/lib/notifications/parent";
import { emitEvent } from "@/lib/automation/emit";
import { dispatchEffects } from "@/lib/automation/effects";
import { logError } from "@/lib/logger";
import type { TableInsert, TableUpdate } from "@/lib/supabase/typed-helpers";
import type { Database } from "@/types/supabase.generated";
import { createRoom } from "@/lib/daily";
import { awardAchievement } from "@/lib/domains/achievements/award";
import { finalizeAttendance } from "@/lib/domains/attendance/finalize";
import {
  SessionEndError,
  SessionNotFoundError,
  StartInstantSessionError,
} from "./types";
import type {
  EndSessionInput,
  EndSessionResult,
  StartInstantSessionInput,
  StartInstantSessionResult,
  RecordNoShowInput,
} from "./types";

/**
 * Session domain — use-case orchestrator (ADR-0004).
 *
 * `endSession` is the canonical cross-domain choreography for the
 * `confirmed → completed` transition. It replaces two duplicated inline
 * paths — teacher `endSession` (src/app/teacher/dashboard/actions.ts) and
 * admin `forceEndSession` (src/app/admin/sessions/actions.ts) — that had
 * drifted into:
 *   - OPPOSITE write orders (teacher: sessions→bookings; admin: bookings→
 *     sessions), each fearing a partial failure in a comment,
 *   - divergent already-ended handling (teacher: idempotent success; admin:
 *     threw "already ended"),
 *   - asymmetric notifications, and
 *   - the admin path SILENTLY never firing `emitEvent("session.ended")`, so
 *     n8n never learned about admin-driven session ends.
 *
 * Sequence:
 *   1. Pre-read the session (booking_id, started_at, ended_at).
 *   2. If already ended → idempotent success (best-effort noop audit), no work.
 *   3. Read the booking (parties, planned duration); compute actual_duration.
 *   4. Atomic critical path via `end_session_with_booking` SQL function
 *      (migration 20260601165807): UPDATE sessions + UPDATE bookings.status in
 *      one transaction. A lost race raises 'session_already_ended' → mapped to
 *      an idempotent already-ended result.
 *   5. Best-effort post-commit (logged, never thrown): diff audit row,
 *      notify(student) + notify(parent), notify(teacher) ONLY when the actor
 *      is not the teacher, and ALWAYS emitEvent("session.ended").
 *
 * Out of scope (lives at the route adapter): auth (teacher-owns-booking /
 * requireAdmin), the `loudAction` envelope, and `revalidatePath`.
 */

interface SessionPreRead {
  booking_id: string;
  started_at: string | null;
  ended_at: string | null;
}

interface BookingParties {
  student_id: string;
  teacher_id: string;
  duration_min: number;
  scheduled_at: string;
}

export async function endSession(input: EndSessionInput): Promise<EndSessionResult> {
  const { sessionId, actorId, reason } = input;
  // admin: endSession/startInstant/recordNoShow — cross-domain writes spanning student+teacher parties + audit_log (issue #523)
  const supabase = createAdminClient();

  // `.maybeSingle()` so a missing row is `{ data: null, error: null }` and maps
  // to SessionNotFoundError — `.single()` returns a PGRST116 *error* on 0 rows,
  // which would surface as a generic SessionEndError instead.
  const { data: session, error: sessReadErr } = await supabase
    .from("sessions")
    .select("booking_id, started_at, ended_at")
    .eq("id", sessionId)
    .maybeSingle<SessionPreRead>();

  if (sessReadErr) throw new SessionEndError("session pre-read failed", { cause: sessReadErr });
  if (!session) throw new SessionNotFoundError(sessionId);

  const { data: booking, error: bookReadErr } = await supabase
    .from("bookings")
    .select("student_id, teacher_id, duration_min, scheduled_at")
    .eq("id", session.booking_id)
    .maybeSingle<BookingParties>();

  if (bookReadErr) throw new SessionEndError("booking pre-read failed", { cause: bookReadErr });
  if (!booking) throw new SessionNotFoundError(session.booking_id);

  const now = new Date();
  const actualDuration = session.started_at
    ? Math.round((now.getTime() - new Date(session.started_at).getTime()) / 60_000)
    : booking.duration_min;

  // Already ended (Daily webhook, double-fire) — idempotent success, no work.
  if (session.ended_at) {
    await writeNoopAudit(supabase, sessionId, actorId);
    return {
      sessionId,
      bookingId: session.booking_id,
      actualDuration,
      alreadyEnded: true,
    };
  }

  // Atomic critical path: sessions UPDATE + bookings UPDATE in one transaction.
  // Cast `as never`: the custom function isn't in the stale generated types
  // (issue #185); its canonical signature lives in src/types/database.ts. Same
  // pattern as confirm_booking_with_session in the booking orchestrator.
  const { error: rpcErr } = await callRpc(supabase, "end_session_with_booking", {
    p_session_id: sessionId,
    p_actual_duration: actualDuration,
  });

  if (rpcErr) {
    // Lost race: the session was ended between our pre-read and the RPC.
    // Treat as idempotent already-ended rather than a user-facing error.
    if (rpcErr.message?.includes("session_already_ended")) {
      return {
        sessionId,
        bookingId: session.booking_id,
        actualDuration,
        alreadyEnded: true,
      };
    }
    throw new SessionEndError("atomic end_session_with_booking failed", { cause: rpcErr });
  }

  // ── Best-effort post-commit — failures logged, never thrown ───────────────
  await writeDiffAudit(supabase, sessionId, actorId, actualDuration, reason);

  try {
    await notify({
      userId: booking.student_id,
      type: "booking",
      title: "تمت الجلسة",
      body: `تم إنهاء الجلسة — المدة الفعلية: ${actualDuration} دقيقة`,
      entityType: "session",
      entityId: sessionId,
    });
  } catch (err) {
    logError("endSession: notify student failed", err, {
      component: "session.orchestrate.endSession",
      metadata: { student_id: booking.student_id, sessionId },
    });
  }

  try {
    await notifyParentSessionComplete(sessionId, actorId);
  } catch (err) {
    logError("endSession: notifyParentSessionComplete failed", err, {
      component: "session.orchestrate.endSession",
      metadata: { student_id: booking.student_id, sessionId },
    });
  }

  // Notify the teacher ONLY when someone other than the teacher ended the
  // session (admin force-end). The teacher who ends their own session does
  // not get a self-notification.
  if (actorId !== booking.teacher_id) {
    try {
      await notify({
        userId: booking.teacher_id,
        type: "system",
        title: "تم إنهاء الجلسة",
        body: reason || "تم إنهاء الجلسة بواسطة المسؤول",
        entityType: "session",
        entityId: sessionId,
      });
    } catch (err) {
      logError("endSession: notify teacher (forced) failed", err, {
        component: "session.orchestrate.endSession",
        metadata: { teacher_id: booking.teacher_id, sessionId },
      });
    }
  }

  // ALWAYS emit — fixes the admin-path silent drop that left n8n blind to
  // admin-driven session ends.
  await emitEvent("session.ended", "session", sessionId, {
    booking_id: session.booking_id,
    teacher_id: booking.teacher_id,
    actual_duration: actualDuration,
    ended_by: actorId,
  }).catch((err) =>
    logError("emit session.ended failed", err, { tag: "automation", event: "session.ended" }),
  );

  // Award first_session badge (spec 033). Idempotent — DB unique constraint
  // makes repeat calls a silent no-op. Best-effort: never blocks the return.
  await awardAchievement(booking.student_id, "first_session").catch((err) =>
    logError("endSession: first_session award failed", err, { tag: "achievements" }),
  );

  // F4: accrue teacher payroll (session_deliveries) now that the booking is
  // completed. A teacher/admin explicitly ending a STARTED session attests it
  // was delivered → 'present'. `finalize_attendance` is idempotent (first-write
  // wins on attendance_records + NOT EXISTS on the delivery) and service-role
  // only; best-effort so a payroll hiccup never turns a successful end into a
  // failure. `started_at` guards against accruing for a session that never began
  // (a genuine no-show goes through recordNoShow → status='no_show', not here).
  if (session.started_at) {
    await finalizeAttendance(supabase, session.booking_id, "present").catch((err) =>
      logError("endSession: finalizeAttendance(present) failed", err, {
        component: "session.orchestrate.endSession",
        metadata: { bookingId: session.booking_id, sessionId },
      }),
    );
  }

  return {
    sessionId,
    bookingId: session.booking_id,
    actualDuration,
    alreadyEnded: false,
  };
}

// Best-effort: a session ended via the Daily webhook before the manual call.
// Records the noop attempt so the audit trail explains the no-state-change.
async function writeNoopAudit(
  supabase: SupabaseClient<Database>,
  sessionId: string,
  actorId: string,
): Promise<void> {
  const { error } = await supabase
    .from("audit_log")
    .insert({
      changed_by: actorId,
      action: "session.end_noop_already_ended",
      table_name: "sessions",
      record_id: sessionId,
      new_data: { note: "endSession called after the session was already ended; noop" },
    } satisfies TableInsert<"audit_log">);
  if (error) logError("endSession: noop audit insert failed", error, { tag: "session" });
}

// Best-effort diff audit row, written for BOTH the teacher and admin paths
// (the teacher inline path previously wrote no diff row).
async function writeDiffAudit(
  supabase: SupabaseClient<Database>,
  sessionId: string,
  actorId: string,
  actualDuration: number,
  reason: string | null | undefined,
): Promise<void> {
  const { error } = await supabase
    .from("audit_log")
    .insert({
      changed_by: actorId,
      action: "session.ended",
      table_name: "sessions",
      record_id: sessionId,
      new_data: { actual_duration: actualDuration },
      reason: reason ?? null,
    } satisfies TableInsert<"audit_log">);
  if (error) logError("endSession: diff audit insert failed", error, { tag: "session" });
}

/**
 * Instant-session orchestrator (ADR-0004).
 *
 * Consolidates the business logic that lived in `teacher/dashboard/actions.ts`
 * `startInstantSession`. The route adapter now:
 *   1. Authenticates the teacher (gets user.id).
 *   2. Validates durationMin (30 | 45 | 60).
 *   3. Fetches teacher_profiles.hourly_rate.
 *   4. Calls this orchestrator.
 *   5. Maps the result / error to a UI-facing response shape.
 *   6. Calls revalidatePath.
 *
 * This orchestrator adds the previously missing `emitEvent("session.instant_started")`,
 * which was the root cause of instant sessions being invisible to n8n automation.
 *
 * Sequence:
 *   1. Check + debit active student package (FR-009). Fails fast with a typed error
 *      so no booking is created when the student has no balance.
 *   2. Insert confirmed booking (status="confirmed", teacher_confirmed=true).
 *   3. Create Daily.co room (2 h TTL).
 *   4. Insert sessions row.
 *   5. Best-effort: notify student in-app; emitEvent("session.instant_started").
 */
export async function startInstantSession(
  input: StartInstantSessionInput,
): Promise<StartInstantSessionResult> {
  const { teacherId, studentId, durationMin, hourlyRate } = input;
  // admin: endSession/startInstant/recordNoShow — cross-domain writes spanning student+teacher parties + audit_log (issue #523)
  const admin = createAdminClient();
  const scheduledAt = new Date();
  const amountUsd = Number((hourlyRate * (durationMin / 60)).toFixed(2));

  // Atomic debit + booking insert (audit Fix 2). One SECURITY DEFINER RPC does
  // the soonest-expiry package debit AND the confirmed-booking insert in a single
  // transaction, so if the insert fails the debit rolls back with it — a retry
  // can never double-charge (the prior code debited then inserted as two separate
  // statements, so a retry-after-insert-failure could charge a second package).
  // The RPC stamps student_package_id so the compensating cancel below restores
  // the SAME package via restore_student_package(). Cast at the call site: the fn
  // isn't in supabase.generated.ts until types regenerate (CLAUDE.md "Migration
  // plus typed calls").
  const { data: newBookingId, error: rpcErr } = await admin.rpc(
    "start_instant_session_booking" as never,
    {
      p_student_id: studentId,
      p_teacher_id: teacherId,
      p_session_type: "hifz",
      p_duration_min: durationMin,
      p_rate_snapshot: hourlyRate,
      p_amount_usd: amountUsd,
      p_scheduled_at: scheduledAt.toISOString(),
    } as never,
  );

  if (rpcErr || !newBookingId) {
    const m = rpcErr?.message ?? "";
    const msg = m.includes("no_active_package")
      ? "لا توجد باقة نشطة للطالب — يرجى تجديد الاشتراك"
      : m.includes("package_debit_failed")
        ? "تعذر خصم رصيد الباقة"
        : "حدث خطأ في إنشاء الحجز";
    throw new StartInstantSessionError(msg, { cause: rpcErr });
  }
  const booking = { id: newBookingId as unknown as string };

  // Compensating cancel helper — restores the debited credit if a later step
  // fails. Cancelling the confirmed booking fires restore_student_package().
  const cancelBooking = async () => {
    await admin
      .from("bookings")
      .update({ status: "cancelled" } satisfies TableUpdate<"bookings">)
      .eq("id", booking.id)
      .then((r: { error: unknown }) => {
        if (r.error) {
          logError("startInstantSession: compensating cancel failed", r.error, {
            component: "session.orchestrate.startInstantSession",
            metadata: { bookingId: booking.id },
          });
        }
      });
  };

  // Create Daily.co room (2 h TTL).
  const expiresAt = new Date(scheduledAt.getTime() + 2 * 60 * 60 * 1000);
  const roomName = `furqan-${booking.id.replace(/-/g, "")}`;
  let room: { name: string; url: string };
  try {
    room = await createRoom(roomName, expiresAt);
  } catch (err) {
    await cancelBooking();
    throw new StartInstantSessionError(
      "تم إنشاء الحجز لكن فشل إنشاء غرفة الفيديو",
      { cause: err },
    );
  }

  // Insert session record.
  const { data: sess, error: sessErr } = await admin
    .from("sessions")
    .insert({
      booking_id: booking.id,
      room_name: room.name,
      room_url: room.url,
      expires_at: expiresAt.toISOString(),
      created_via: "manual",
    } satisfies TableInsert<"sessions">)
    .select("id")
    .single<{ id: string }>();

  if (sessErr || !sess) {
    await cancelBooking();
    throw new StartInstantSessionError(
      "تم إنشاء الحجز لكن فشل تسجيل الجلسة",
      { cause: sessErr },
    );
  }

  // ── Best-effort post-commit — failures logged, never thrown ───────────────
  try {
    await notify({
      userId: studentId,
      type: "booking",
      title: "جلسة فورية",
      body: "المعلم بدأ جلسة فورية — انضم الآن!",
      entityType: "booking",
      entityId: booking.id,
    });
  } catch (err) {
    logError("startInstantSession: notify student failed", err, {
      component: "session.orchestrate.startInstantSession",
      metadata: { studentId, bookingId: booking.id },
    });
  }

  await emitEvent(
    "session.instant_started",
    "session",
    sess.id,
    {
      booking_id: booking.id,
      teacher_id: teacherId,
      student_id: studentId,
      duration_min: durationMin,
      room_url: room.url,
    },
    teacherId,
  ).catch((err) =>
    logError("emit session.instant_started failed", err, {
      tag: "automation",
      event: "session.instant_started",
    }),
  );

  return { sessionId: sess.id, bookingId: booking.id, roomUrl: room.url };
}

/**
 * No-show orchestrator (ADR-0004).
 *
 * Moves the cross-domain fan-out that lived in `teacher/dashboard/actions.ts`
 * `markNoShow` (handler section). The route adapter now:
 *   1. Authenticates the teacher (gets actorId).
 *   2. Verifies the booking belongs to the teacher (SELECT scoped to teacher_id).
 *   3. Calls this orchestrator.
 *   4. Maps the result to `{ message }` for the loudAction response.
 *   5. Calls revalidatePath.
 *
 * Sequence:
 *   1. Read booking parties (needed for notifications).
 *   2. UPDATE bookings.status = 'no_show' (atomic).
 *   3. UPDATE sessions.ended_at (best-effort — session row may not exist).
 *   4. dispatchEffects("session.no_show") → student in-app notify via EVENT_EFFECTS.
 *   5. notifyParentNoShow — complex parent lookup + report insert; cannot be
 *      an EffectResolver because it does its own DB reads and is not pure.
 *   6. emitEvent("session.no_show") → n8n / parent automation.
 */
export async function recordNoShow(input: RecordNoShowInput): Promise<void> {
  const { bookingId, actorId } = input;
  // admin: endSession/startInstant/recordNoShow — cross-domain writes spanning student+teacher parties + audit_log (issue #523)
  const admin = createAdminClient();
  const noShowAt = new Date().toISOString();

  // Pre-read booking parties for notification fan-out.
  const { data: booking, error: bookReadErr } = await admin
    .from("bookings")
    .select("student_id, teacher_id")
    .eq("id", bookingId)
    .maybeSingle<{ student_id: string; teacher_id: string }>();

  if (bookReadErr) {
    throw new Error("recordNoShow: booking read failed");
  }
  if (!booking) {
    throw new Error("الحجز غير موجود");
  }

  // Atomic status update.
  const { error } = await admin
    .from("bookings")
    .update({ status: "no_show" } satisfies TableUpdate<"bookings">)
    .eq("id", bookingId);

  if (error) throw error;

  // Mark session ended — non-blocking (no-show may occur before session starts).
  await admin
    .from("sessions")
    .update({ ended_at: noShowAt } satisfies TableUpdate<"sessions">)
    .eq("booking_id", bookingId)
    .then((r: { error: unknown }) => {
      if (r.error) {
        logError("recordNoShow: sessions ended_at update failed", r.error, {
          tag: "session",
          metadata: { bookingId },
        });
      }
    });

  // ── Best-effort post-commit — failures logged, never thrown ───────────────
  // In-app student notification via the declarative effects map.
  await dispatchEffects("session.no_show", {
    studentId: booking.student_id,
    entityType: "booking",
    entityId: bookingId,
  });

  try {
    await notifyParentNoShow(
      booking.student_id,
      actorId,
      noShowAt,
      actorId,
    );
  } catch (err) {
    logError("recordNoShow: notifyParentNoShow failed", err, {
      component: "session.orchestrate.recordNoShow",
      metadata: { bookingId, student_id: booking.student_id },
    });
  }

  await emitEvent(
    "session.no_show",
    "booking",
    bookingId,
    { student_id: booking.student_id, teacher_id: booking.teacher_id },
    actorId,
  ).catch((err) =>
    logError("emit session.no_show failed", err, {
      tag: "automation",
      event: "session.no_show",
    }),
  );
}
