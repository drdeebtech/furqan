import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase.generated";
import { logError } from "@/lib/logger";

/**
 * Spec 020 — Scheduling (US1 / T008).
 *
 * Domain layer for teacher availability (dated instances).
 */

export interface AvailabilitySlot {
  id: string;
  teacher_id: string;
  slot_date: string;
  start_time: string;
  end_time: string;
  is_booked: boolean;
}

/**
 * Fetch open slots for a teacher within a horizon.
 * Operates on dated instances (teacher_availability_instances), not templates.
 */
export async function getOpenSlots(
  supabase: SupabaseClient<Database>,
  teacherId: string,
  month?: string, // YYYY-MM
): Promise<AvailabilitySlot[]> {
  let query = supabase
    .from("teacher_availability_instances")
    .select("*")
    .eq("teacher_id", teacherId)
    .eq("is_booked", false);

  if (month) {
    const start = `${month}-01`;
    const [year, mon] = month.split("-").map(Number);
    const nextMonth =
      mon === 12
        ? `${year + 1}-01-01`
        : `${year}-${String(mon + 1).padStart(2, "0")}-01`;
    query = query.gte("slot_date", start).lt("slot_date", nextMonth);
  } else {
    // Default to today onwards
    query = query.gte("slot_date", new Date().toISOString().split("T")[0]);
  }

  const { data, error } = await query.order("slot_date").order("start_time");

  if (error) throw error;
  return data ?? [];
}

/**
 * Lock one dated slot instance for booking race prevention.
 * Delegates to the `lock_slot_instance` SECURITY DEFINER RPC (SELECT FOR
 * UPDATE + UPDATE in one transaction). Returns true iff the slot exists
 * and was not already booked.
 */
export async function lockSlot(
  admin: SupabaseClient<Database>,
  slotInstanceId: string,
): Promise<boolean> {
  const { data, error } = await admin.rpc("lock_slot_instance", {
    p_slot_id: slotInstanceId,
  });

  if (error) throw error;
  return data;
}

/**
 * Best-effort unlock of a dated slot instance (reverses lockSlot on insert
 * failure). Never throws — logs any error internally so the caller's
 * rollback path stays clean. The returned Promise resolves once the update
 * (and any error log) has settled.
 */
export async function unlockSlot(
  admin: SupabaseClient<Database>,
  slotInstanceId: string,
): Promise<void> {
  const { error } = await admin
    .from("teacher_availability_instances")
    .update({ is_booked: false })
    .eq("id", slotInstanceId);

  if (error) {
    // Best-effort: this runs on the rollback path where the caller is
    // already dealing with a primary failure. Surface the secondary failure
    // to Sentry so an orphaned-lock pattern is observable.
    logError("unlockSlot: best-effort rollback failed", error, {
      tag: "scheduling",
      slot_id: slotInstanceId,
    });
  }
}

/**
 * Helper to ensure availability instances are materialized for a teacher up to a date.
 * Calls the SECURITY DEFINER materialization fn.
 */
export async function ensureInstancesMaterialized(
  admin: SupabaseClient<Database>,
  horizonEnd: string,
): Promise<void> {
  const { error } = await admin.rpc("materialize_availability_instances", {
    p_horizon_end: horizonEnd
  });
  if (error) throw error;
}
