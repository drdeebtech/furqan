"use server";
import { revalidatePath } from "next/cache";
import { emitEvent } from "@/lib/automation/emit";
import { requireAdmin, ForbiddenError } from "@/lib/auth/require-admin";
import { logError } from "@/lib/logger";
import type { BookingStatus } from "@/types/database";
import { updateBookingStatus as updateBookingStatusDomain } from "@/lib/domains/booking/actions";
import {
  BookingNotFoundError,
  BookingStatusUpdateError,
} from "@/lib/domains/booking/types";

/**
 * Admin route adapter for single-booking status updates.
 *
 * Per ADR-0002:
 *   - requireAdmin auth + revalidatePath stay here (route concerns).
 *   - bookings UPDATE + audit_log INSERT delegate to the domain
 *     `updateBookingStatus(input)`.
 *   - emitEvent stays at the route adapter (per §1, mirroring createBooking).
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
  // No-op transitions stay silent (matches the previous behavior where
  // a same-status UPDATE would still write audit + emit; new behavior
  // skips both — defensible improvement, no downstream consumer relies
  // on duplicate-state events).
  if (!result.alreadyInTargetState) {
    const eventName =
      newStatus === "confirmed" ? "booking.confirmed"
      : newStatus === "cancelled" ? "booking.cancelled"
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
