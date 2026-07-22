import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { callRpc } from "@/lib/supabase/rpc";
import { createRoom } from "@/lib/daily";
import { notify } from "@/lib/notifications/dispatcher";
import { emitEvent } from "@/lib/automation/emit";
import { logError } from "@/lib/logger";
import type { BookingStatus } from "@/types/database";
import { updateBookingStatus } from "./actions";
import {
  BookingAlreadyConfirmedError,
  BookingConfirmError,
  BookingNoPackageError,
  BookingNotFoundError,
  BookingRoomCreationError,
} from "./types";
import type {
  CancelBookingInput,
  CancelBookingResult,
  ConfirmBookingInput,
  ConfirmBookingResult,
} from "./types";

/**
 * Booking domain — use-case orchestrator (ADR-0004).
 *
 * `confirmBooking` is the canonical cross-domain choreography for the
 * `pending → confirmed` transition. It owns the order of operations
 * that previously lived inline at every route adapter that confirmed
 * a booking, replacing two duplicated paths (teacher dashboard +
 * admin bookings) that had drifted into divergent orderings and
 * asymmetric side effects.
 *
 * Sequence:
 *   1. Pre-read the booking row (status, scheduling, parties).
 *   2. Reject if not in `pending` (BookingAlreadyConfirmedError, etc.).
 *   3. createRoom on Daily.co BEFORE any DB write — if it throws, the
 *      booking stays `pending` and no sessions row exists. Orphaned
 *      Daily rooms are cheap and self-expire; orphaned bookings would
 *      be a user-visible bug.
 *   4. Atomic critical path via `confirm_booking_with_session` SQL
 *      function (migration 20260508011953): UPDATE bookings.status +
 *      INSERT sessions in one transaction.
 *   5. Best-effort post-commit: notify(student) + emitEvent. Failures
 *      logged via logError, never thrown to caller — the booking is
 *      confirmed and the source of truth (bookings + sessions rows)
 *      is committed.
 *
 * Failure shape (per ADR-0002 §4 / ADR-0004): throws on every error
 * path with a domain-specific Error subclass. Route adapters catch
 * them and shape into the form-friendly `{ error }` response.
 *
 * Out of scope (lives at the route adapter):
 *   - FormData parsing, auth (`requireRole(...)`), role-specific
 *     preconditions (the teacher route's eval-discipline gate, the
 *     auto-cancel-of-overlapping-pending-bookings logic).
 *   - HTTP redirect on success.
 *   - The `loudAction` audit/Sentry/Telegram envelope — orchestrator
 *     is a pure function called by the wrapped route.
 */

// 2-hour buffer past scheduled_at for Daily.co room expiry. Matches the
// value the inline teacher route was using before this orchestrator
// existed (src/app/teacher/dashboard/actions.ts:201 prior to migration).
const ROOM_EXPIRY_BUFFER_MS = 2 * 60 * 60 * 1000;

// Internal pre-read shape — kept narrow to the columns the orchestrator
// actually consumes. Wider selects cost cache space without buying
// anything.
interface BookingPreRead {
  status: BookingStatus;
  student_id: string;
  teacher_id: string;
  scheduled_at: string;
  duration_min: number;
}

export async function confirmBooking(
  input: ConfirmBookingInput,
): Promise<ConfirmBookingResult> {
  const { bookingId, actorId } = input;
  // admin: confirmBooking cross-domain: writes booking + session spanning student+teacher parties (issue #523)
  const supabase = createAdminClient();

  // 1. Pre-read. Service-role client bypasses RLS — auth has already
  //    been performed by the calling route adapter (`requireRole(...)`).
  const { data: booking, error: bookingReadErr } = await supabase
    .from("bookings")
    .select("status, student_id, teacher_id, scheduled_at, duration_min")
    .eq("id", bookingId)
    .single<BookingPreRead>();

  if (bookingReadErr && bookingReadErr.code !== "PGRST116") {
    const err = new BookingConfirmError(bookingReadErr.message);
    err.cause = bookingReadErr;
    throw err;
  }

  if (!booking) {
    throw new BookingNotFoundError(bookingId);
  }

  // 2. State guard. The atomic SQL function would also reject this case
  //    via `booking_not_pending`, but a pre-flight check avoids spinning
  //    up a Daily.co room only to throw it away. Also distinguishes
  //    "already confirmed" (idempotent retry) from "wrong state, e.g.
  //    cancelled" without parsing SQL error messages downstream.
  if (booking.status !== "pending") {
    throw new BookingAlreadyConfirmedError(bookingId);
  }

  // 3. Create Daily.co room. Done BEFORE the DB transaction so a Daily
  //    outage never produces a confirmed booking with no room. The room
  //    name is derived deterministically from the booking id so retries
  //    are idempotent on Daily's side too (Daily 409s the same room
  //    name; createRoom raises — acceptable for a retry).
  const scheduledAt = new Date(booking.scheduled_at);
  const expiresAt = new Date(scheduledAt.getTime() + ROOM_EXPIRY_BUFFER_MS);
  const roomName = `furqan-${bookingId.replace(/-/g, "")}`;

  let room: { url: string; name: string };
  try {
    room = await createRoom(roomName, expiresAt);
  } catch (err) {
    logError("confirmBooking: Daily.co createRoom failed", err, {
      tag: "booking-orchestrate",
      severity: "warning",
      metadata: { bookingId, actorId },
    });
    throw new BookingRoomCreationError(
      err instanceof Error ? err.message : "createRoom failed",
    );
  }

  // 4. Atomic critical path via the SQL function. The RPC return type
  //    isn't in supabase.generated.ts until the migration applies +
  //    types regenerate, so we cast at the call site (per CLAUDE.md
  //    "Migration plus typed calls" guidance).
  const { data: rpcData, error: rpcErr } = await callRpc(
    supabase,
    "confirm_booking_with_session",
    {
      p_booking_id: bookingId,
      p_room_url: room.url,
      p_room_name: room.name,
      p_expires_at: expiresAt.toISOString(),
    },
  );

  if (rpcErr) {
    // Fail-closed money guard: the SQL function raises `no_package_credit`
    // (errcode P0001) when a paid 1:1 confirmed with no package charged
    // (the deduct_student_package trigger no-op'd). The whole RPC rolled
    // back, so the booking stays `pending` and no session row exists. This
    // is NOT "already confirmed" — surface it as a distinct confirm error
    // so the route adapter tells the student to buy/activate a package.
    // Checked BEFORE the generic P0001 branch because both share errcode.
    if (rpcErr.message.includes("no_package_credit")) {
      logError("confirmBooking: refused — no package credit", rpcErr, {
        tag: "booking-orchestrate",
        severity: "warning",
        metadata: { bookingId, actorId },
      });
      throw new BookingNoPackageError();
    }

    // Race lost: someone transitioned the booking between our pre-read
    // and the UPDATE. The SQL function raises `booking_not_pending`
    // (errcode P0001) — translate to the same error class as the
    // pre-read state guard so route adapters have one branch to handle.
    if (
      rpcErr.message.includes("booking_not_pending") ||
      rpcErr.code === "P0001"
    ) {
      throw new BookingAlreadyConfirmedError(bookingId);
    }
    logError("confirmBooking: atomic RPC failed", rpcErr, {
      tag: "booking-orchestrate",
      severity: "warning",
      metadata: { bookingId, actorId, rpcMessage: rpcErr.message },
    });
    throw new BookingConfirmError(rpcErr.message);
  }

  // The SQL function returns the new sessions.id as a UUID. Cast at
  // the boundary; the SQL contract is the source of truth.
  const sessionId = rpcData as unknown as string;
  if (!sessionId) {
    // Defensive — RPC returned no error but no id either. Treat as a
    // confirm failure rather than fabricate an id downstream.
    throw new BookingConfirmError("confirm_booking_with_session returned no session id");
  }

  // 5. Best-effort post-commit fan-out. Failures don't roll back the
  //    booking — bookings.status='confirmed' + sessions row is the
  //    committed source of truth. Each side effect is independently
  //    logged so an n8n outage doesn't mask a notify failure (and vice
  //    versa).
  const scheduledDateLocal = scheduledAt.toLocaleDateString("ar");
  await notify({
    userId: booking.student_id,
    type: "booking",
    title: "تم تأكيد حجزك",
    body: `تم تأكيد جلستك بتاريخ ${scheduledDateLocal} — يمكنك الانضمام من صفحة الجلسات`,
    entityType: "booking",
    entityId: bookingId,
  }).catch((err) =>
    logError("confirmBooking: notify(student) failed", err, {
      tag: "booking-orchestrate",
      metadata: { bookingId, studentId: booking.student_id },
    }),
  );

  await emitEvent(
    "booking.confirmed",
    "booking",
    bookingId,
    {
      student_id: booking.student_id,
      teacher_id: booking.teacher_id,
      session_id: sessionId,
    },
    actorId,
  ).catch((err) =>
    logError("confirmBooking: emitEvent(booking.confirmed) failed", err, {
      tag: "booking-orchestrate",
      metadata: { bookingId },
    }),
  );

  return {
    bookingId,
    sessionId,
    roomUrl: room.url,
    roomName: room.name,
    studentId: booking.student_id,
    teacherId: booking.teacher_id,
  };
}

/**
 * Booking domain — cancel orchestrator (ADR-0004 follow-up).
 *
 * One place owns "what happens when a booking is cancelled":
 *   1. Domain write via updateBookingStatus (audit row, no-op
 *      short-circuit, throws on failure).
 *   2. Best-effort post-commit: notify(student) with role-appropriate
 *      wording + emitEvent("booking.cancelled"). Skipped entirely when
 *      the booking was already cancelled (idempotent retry).
 *
 * Replaces three divergent inline paths (teacher hand-rolled everything;
 * admin never notified the student; bulk stays intentionally silent and
 * does NOT use this orchestrator).
 * Role-specific preconditions (teacher ownership check) stay at the
 * route adapter, mirroring confirmBooking's eval-gate precedent.
 */
export async function cancelBooking(
  input: CancelBookingInput,
): Promise<CancelBookingResult> {
  const { bookingId, actorId, actorRole, reason } = input;

  const write = await updateBookingStatus({
    bookingId,
    newStatus: "cancelled",
    actorId,
    reason,
  });

  if (write.alreadyInTargetState) {
    return {
      bookingId,
      studentId: write.studentId,
      teacherId: write.teacherId,
      alreadyCancelled: true,
    };
  }

  const message =
    actorRole === "teacher"
      ? {
          title: "تم رفض حجزك",
          body: "للأسف تم رفض حجزك من قبل المعلم — يمكنك حجز موعد آخر",
        }
      : {
          title: "تم إلغاء حجزك",
          body: "تم إلغاء حجزك من قبل الإدارة — يمكنك حجز موعد بديل",
        };

  // notify() is never-throw (Task 1), but keep the .catch for defense in
  // depth against a future regression — matches confirmBooking's shape.
  await notify({
    userId: write.studentId,
    type: "booking",
    title: message.title,
    body: message.body,
    entityType: "booking",
    entityId: bookingId,
  }).catch((err) =>
    logError("cancelBooking: notify(student) failed", err, {
      tag: "booking-orchestrate",
      metadata: { bookingId, studentId: write.studentId },
    }),
  );

  await emitEvent(
    "booking.cancelled",
    "booking",
    bookingId,
    {
      student_id: write.studentId,
      teacher_id: write.teacherId,
      new_status: "cancelled",
    },
    actorId,
  ).catch((err) =>
    logError("cancelBooking: emitEvent(booking.cancelled) failed", err, {
      tag: "booking-orchestrate",
      metadata: { bookingId },
    }),
  );

  return {
    bookingId,
    studentId: write.studentId,
    teacherId: write.teacherId,
    alreadyCancelled: false,
  };
}
