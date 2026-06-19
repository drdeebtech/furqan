import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase.generated";

/**
 * Spec 021 — Teacher payroll.
 *
 * Monthly aggregation via the `run_monthly_payroll` SECURITY DEFINER RPC.
 * FR-029 (constant rate per teacher/month) and FR-030 (no $0 payouts for
 * missing/zero rate) are enforced inside the RPC; this wrapper re-derives
 * the structured exceptions list so the API can surface them to ops rather
 * than relying on RAISE WARNING log lines alone.
 */

export interface PayrollException {
  teacherId: string;
  reason: "missing_or_zero_rate" | "non_uniform_rate";
}

export interface PayrollRunResult {
  payoutsCreated: number;
  month: string;
  exceptions: PayrollException[];
}

/**
 * Run payroll for a closed month (YYYY-MM-01). Idempotent — re-running for
 * the same month inserts 0 duplicates (ON CONFLICT DO NOTHING in the RPC).
 */
export async function runMonthlyPayroll(
  admin: SupabaseClient<Database>,
  month: string, // YYYY-MM-01
): Promise<PayrollRunResult> {
  const { data: inserted, error } = await admin.rpc("run_monthly_payroll", {
    p_month: month,
  });

  if (error) throw error;

  // Re-derive exceptions: same predicates as the RPC's RAISE WARNING loop.
  const { data: offenders, error: offErr } = await admin
    .from("session_deliveries")
    .select("teacher_id, hourly_rate_usd")
    .eq("payroll_period_month", month);

  if (offErr) throw offErr;

  const byTeacher = new Map<string, { rates: Set<number>; maxIsZero: boolean }>();
  for (const row of offenders ?? []) {
    const rate = Number(row.hourly_rate_usd ?? 0);
    const entry = byTeacher.get(row.teacher_id) ?? { rates: new Set(), maxIsZero: false };
    entry.rates.add(rate);
    if (rate === 0) entry.maxIsZero = true;
    byTeacher.set(row.teacher_id, entry);
  }

  const exceptions: PayrollException[] = [];
  for (const [teacherId, { rates, maxIsZero }] of byTeacher) {
    if (maxIsZero || rates.size === 1 && rates.has(0)) {
      exceptions.push({ teacherId, reason: "missing_or_zero_rate" });
    } else if (rates.size > 1) {
      exceptions.push({ teacherId, reason: "non_uniform_rate" });
    }
  }

  return {
    payoutsCreated: Number(inserted ?? 0),
    month,
    exceptions,
  };
}

export interface PayoutQuery {
  teacherId?: string;
  month?: string;
  status?: "pending" | "paid" | "failed";
}

/**
 * List payouts with RLS-enforced scoping. Teachers see only their own;
 * admins can query any. Service-role bypasses RLS.
 */
export async function getPayouts(
  client: SupabaseClient<Database>,
  query: PayoutQuery,
): Promise<Database["public"]["Tables"]["teacher_payouts"]["Row"][]> {
  let q = client.from("teacher_payouts").select("*");
  if (query.teacherId) q = q.eq("teacher_id", query.teacherId);
  if (query.month) q = q.eq("payroll_period_month", query.month);
  if (query.status) q = q.eq("status", query.status);
  const { data, error } = await q.order("payroll_period_month", { ascending: false });
  if (error) throw error;
  return data ?? [];
}
