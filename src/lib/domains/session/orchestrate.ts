import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { callRpc } from "@/lib/supabase/rpc";
import { notify } from "@/lib/notifications/dispatcher";
import { notifyParentSessionComplete } from "@/lib/notifications/parent";
import { emitEvent } from "@/lib/automation/emit";
import { logError } from "@/lib/logger";
import type { TableInsert } from "@/lib/supabase/typed-helpers";
import type { Database } from "@/types/supabase.generated";
import { SessionEndError, SessionNotFoundError } from "./types";
import type { EndSessionInput, EndSessionResult } from "./types";

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
    await notifyParentSessionComplete(
      booking.student_id,
      booking.teacher_id,
      // When force-ending a not-yet-started session, date the parent's
      // completion report to the booked session date, not the admin-action time.
      session.started_at ?? booking.scheduled_at,
      actualDuration,
      actorId,
    );
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
  await supabase
    .from("audit_log")
    .insert({
      changed_by: actorId,
      action: "session.end_noop_already_ended",
      table_name: "sessions",
      record_id: sessionId,
      new_data: { note: "endSession called after the session was already ended; noop" },
    } satisfies TableInsert<"audit_log">)
    .then((r: { error: unknown }) => {
      if (r.error) logError("endSession: noop audit insert failed", r.error, { tag: "session" });
    });
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
  await supabase
    .from("audit_log")
    .insert({
      changed_by: actorId,
      action: "session.ended",
      table_name: "sessions",
      record_id: sessionId,
      new_data: { actual_duration: actualDuration },
      reason: reason ?? null,
    } satisfies TableInsert<"audit_log">)
    .then((r: { error: unknown }) => {
      if (r.error) logError("endSession: diff audit insert failed", r.error, { tag: "session" });
    });
}
