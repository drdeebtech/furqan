"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin, ForbiddenError } from "@/lib/auth/require-admin";
import type { BookingStatus } from "@/types/database";

export interface BulkBookingResult {
  updated: number;
  failed: number;
  errors: string[];
}

interface BookingRow {
  id: string;
  status: BookingStatus;
}

const VALID_TRANSITIONS: ReadonlySet<BookingStatus> = new Set<BookingStatus>([
  "confirmed",
  "cancelled",
  "no_show",
]);

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

  const admin = createAdminClient();
  const effectiveReason =
    (reason ?? "").trim() ||
    (status === "no_show" ? "admin bulk mark: no-show" : "admin bulk action");

  // Process one at a time so DB triggers (v14.1 credits / v14.3 packages) fire
  // on each transition and so per-row audit rows are written.
  for (const id of ids) {
    try {
      const { data: existing } = await admin
        .from("bookings")
        .select("id, status")
        .eq("id", id)
        .single<BookingRow>();

      if (!existing) {
        result.failed += 1;
        result.errors.push(`الحجز ${id.slice(0, 8)}… غير موجود`);
        continue;
      }
      if (existing.status === status) {
        // Already in the target state — skip silently to keep the batch clean.
        continue;
      }

      const { error: updateErr } = await admin
        .from("bookings")
        .update({ status } as never)
        .eq("id", id);

      if (updateErr) {
        result.failed += 1;
        result.errors.push(`${id.slice(0, 8)}…: ${updateErr.message}`);
        continue;
      }

      await admin.from("audit_log").insert({
        changed_by: actorId,
        table_name: "bookings",
        record_id: id,
        action: "UPDATE",
        old_data: { status: existing.status },
        new_data: { status, reason: effectiveReason },
        reason: `admin bulk ${status}: ${effectiveReason}`,
      } as never);

      result.updated += 1;
    } catch (err) {
      result.failed += 1;
      result.errors.push(err instanceof Error ? err.message : "فشل غير متوقع");
    }
  }

  revalidatePath("/admin/bookings");
  revalidatePath("/admin/dashboard");
  revalidatePath("/admin/control-tower");
  return result;
}
