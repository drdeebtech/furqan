"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, ForbiddenError } from "@/lib/auth/require-admin";
import type { BookingStatus } from "@/types/database";
import { updateBookingStatus as updateBookingStatusDomain } from "@/lib/domains/booking/actions";
import {
  BookingNotFoundError,
  BookingStatusUpdateError,
} from "@/lib/domains/booking/types";

export interface BulkBookingResult {
  updated: number;
  failed: number;
  errors: string[];
}

const VALID_TRANSITIONS: ReadonlySet<BookingStatus> = new Set<BookingStatus>([
  "confirmed",
  "cancelled",
  "no_show",
]);

/**
 * Admin route adapter for bulk booking status updates.
 *
 * Per ADR-0002:
 *   - requireAdmin auth + VALID_TRANSITIONS gate + revalidatePath stay here.
 *   - Each per-id status change delegates to the domain
 *     `updateBookingStatus(input)`.
 *
 * Bulk does NOT emit events (preserves prior behavior — per-row events
 * would amplify n8n traffic; bulk operations should be summarized
 * separately if downstream consumers want to react). The domain still
 * gets called for each id so audit rows are written and DB-level
 * transition triggers fire normally.
 */
export async function bulkUpdateBookingStatus({
  ids,
  status,
  reason,
}: {
  ids: string[];
  status: BookingStatus;
  reason?: string;
}): Promise<BulkBookingResult> {
  const result: BulkBookingResult = { updated: 0, failed: 0, errors: [] };

  if (!Array.isArray(ids) || ids.length === 0) return result;
  if (!VALID_TRANSITIONS.has(status)) {
    result.failed = ids.length;
    result.errors.push("حالة غير صالحة");
    return result;
  }

  let actorId: string;
  try {
    ({ id: actorId } = await requireAdmin());
  } catch (e) {
    result.failed = ids.length;
    result.errors.push(e instanceof ForbiddenError ? "ليس لديك صلاحية" : "تعذر التحقق من الصلاحية");
    return result;
  }

  const effectiveReason =
    (reason ?? "").trim() ||
    (status === "no_show" ? "admin bulk mark: no-show" : "admin bulk action");

  // Process one at a time so DB triggers (v14.1 credits / v14.3 packages) fire
  // on each transition and so per-row audit rows are written.
  for (const id of ids) {
    try {
      const res = await updateBookingStatusDomain({
        bookingId: id,
        newStatus: status,
        actorId,
        reason: `admin bulk ${status}: ${effectiveReason}`,
      });
      // Already-in-target-state stays silent (preserves the original
      // skip-without-counting behavior).
      if (!res.alreadyInTargetState) {
        result.updated += 1;
      }
    } catch (err) {
      if (err instanceof BookingNotFoundError) {
        result.failed += 1;
        result.errors.push(`الحجز ${id.slice(0, 8)}… غير موجود`);
        continue;
      }
      if (err instanceof BookingStatusUpdateError) {
        result.failed += 1;
        result.errors.push(`${id.slice(0, 8)}…: ${err.message}`);
        continue;
      }
      result.failed += 1;
      result.errors.push(err instanceof Error ? err.message : "فشل غير متوقع");
    }
  }

  revalidatePath("/admin/bookings");
  revalidatePath("/admin/dashboard");
  revalidatePath("/admin/control-tower");
  return result;
}
