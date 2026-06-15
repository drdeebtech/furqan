"use server";
import { revalidatePath } from "next/cache";
import { emitEvent } from "@/lib/automation/emit";
import { requireAdmin, ForbiddenError } from "@/lib/auth/require-admin";
import { logError } from "@/lib/logger";
import type { BookingStatus } from "@/types/database";
import { updateBookingStatus as updateBookingStatusDomain } from "@/lib/domains/booking/actions";
import { confirmBooking } from "@/lib/domains/booking/orchestrate";
import {
  BookingAlreadyConfirmedError,
  BookingConfirmError,
  BookingNoPackageError,
  BookingNotFoundError,
  BookingRoomCreationError,
  BookingStatusUpdateError,
} from "@/lib/domains/booking/types";

/**
 * Admin route adapter for single-booking status updates.
 *
 * Per ADR-0002 / ADR-0004:
 *   - requireAdmin auth + revalidatePath stay here (route concerns).
 *   - For `pending → confirmed`: delegate to the use-case orchestrator
 *     `confirmBooking(input)` (ADR-0004). The orchestrator owns the
 *     atomic bookings UPDATE + sessions INSERT + best-effort notify +
 *     emitEvent fan-out. The previous admin path skipped createRoom and
 *     student notify entirely — that asymmetric drift goes away because
 *     teacher and admin route adapters now share the same orchestrator.
 *   - For other transitions (cancel, complete, etc.): keep delegating
 *     to the existing `updateBookingStatusDomain` (ADR-0002). emitEvent
 *     stays here for those branches, mirroring the createBooking
 *     precedent.
 *
 * Not wrapped in `loudAction` because it's not useActionState-bound here;
 * callers consume the `{ success } | { error }` shape directly. (Per
 * ADR-0002 §4 update, that route shape is fine — the wrapper isn't
 * mandatory, only the throw/return invariant on the domain side is.)
 */
export async function adminUpdateBookingStatus(bookingId: string, status: string) {
  let actorId: string;
  try {
    const admin = await requireAdmin();
    actorId = admin.id;
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "ليس لديك صلاحية" };
    throw e;
  }

  // The route accepts an unconstrained `string` to preserve the existing
  // call shape from page.tsx. Narrowing happens here at the boundary.
  const newStatus = status as BookingStatus;

  // Confirm path: orchestrator owns the choreography end-to-end —
  // Daily room creation, sessions row insert (atomic with bookings
  // UPDATE), student notify, and emitEvent("booking.confirmed").
  if (newStatus === "confirmed") {
    try {
      await confirmBooking({ bookingId, actorId });
    } catch (err) {
      if (err instanceof BookingAlreadyConfirmedError) {
        return { error: "الحجز مؤكد بالفعل أو في حالة لا تسمح بالتأكيد" };
      }
      if (err instanceof BookingNotFoundError) {
        return { error: "الحجز غير موجود" };
      }
      if (err instanceof BookingRoomCreationError) {
        logError("admin confirmBooking: createRoom failed", err, {
          tag: "admin-bookings",
          severity: "warning",
          metadata: { bookingId, actorId },
        });
        return { error: "تعذر إنشاء غرفة الفيديو — يرجى المحاولة مرة أخرى" };
      }
      // Specific (subclass) BEFORE the generic BookingConfirmError: the
      // fail-closed money guard refused because the student has no package
      // credit — surface the actionable guidance instead of a generic error.
      if (err instanceof BookingNoPackageError) {
        logError("admin confirmBooking: refused — no package credit", err, {
          tag: "admin-bookings",
          severity: "warning",
          metadata: { bookingId, actorId },
        });
        return { error: err.message };
      }
      if (err instanceof BookingConfirmError) {
        logError("admin confirmBooking: orchestrator failed", err, {
          tag: "admin-bookings",
          severity: "warning",
          metadata: { bookingId, actorId },
        });
        return { error: "تعذر تأكيد الحجز" };
      }
      throw err;
    }
    revalidatePath("/admin/bookings");
    return { success: true };
  }

  // Non-confirm transitions: keep using the existing domain function.
  let result;
  try {
    result = await updateBookingStatusDomain({
      bookingId,
      newStatus,
      actorId,
      reason: `Admin set booking ${newStatus}`,
    });
  } catch (err) {
    if (err instanceof BookingNotFoundError) return { error: "الحجز غير موجود" };
    if (err instanceof BookingStatusUpdateError) {
      logError("admin updateBookingStatus failed", err, {
        tag: "admin-bookings",
        severity: "warning",
        metadata: { bookingId, status: newStatus, actorId },
      });
      return { error: "تعذر تحديث الحجز" };
    }
    throw err;
  }

  // Emit per-status event only when the row actually transitioned.
  // (`confirmed` is handled above by the orchestrator and never reaches
  // this branch — keeps the emit single-source-of-truth per status.)
  if (!result.alreadyInTargetState) {
    const eventName =
      newStatus === "cancelled" ? "booking.cancelled"
      : "booking.status_changed";
    try {
      await emitEvent(
        eventName,
        "booking",
        bookingId,
        {
          student_id: result.studentId,
          teacher_id: result.teacherId,
          new_status: newStatus,
        },
        actorId,
      );
    } catch (err) {
      logError("admin updateBookingStatus: emitEvent failed", err, {
        tag: "admin-bookings",
      });
    }
  }

  revalidatePath("/admin/bookings");
  return { success: true };
}
