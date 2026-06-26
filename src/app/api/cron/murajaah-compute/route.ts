/**
 * Murajaah SM-2 nightly batch compute (spec 001, FR-008).
 *
 * Triggered once per day by n8n (canonical scheduler per CLAUDE.md — NOT a
 * Vercel cron). Seeds a review-schedule row for each newly-memorised item and
 * fills each student's daily batch (≤15 due items in the 7-day fresh window).
 * The student dashboard then reads `batch_for_date = today`.
 *
 * v1 simplification: computes for the current UTC date. Per-student-local-date
 * batching (FR-015) is a v2 refinement; at v1 volume the ≤1-day edge near
 * midnight is acceptable and avoids iterating timezones.
 *
 * Auth: the canonical dual pattern — Authorization: Bearer CRON_SECRET OR
 * X-N8N-Secret header (matches murajaah-due / audit-cleanup).
 *
 * To wire on n8n: HTTP GET https://www.furqan.today/api/cron/murajaah-compute
 *   Headers: { "X-N8N-Secret": "{{ $env.N8N_WEBHOOK_SECRET }}" }, schedule "0 2 * * *".
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withAuthedCronMonitor } from "@/lib/sentry/cron";
import { logError } from "@/lib/logger";

export const GET = withAuthedCronMonitor(
  "cron-murajaah-compute",
  "0 2 * * *",
  async () => {
    // admin: cron — no user session; SECURITY DEFINER RPC (issue #523)
    const admin = createAdminClient();
    const today = new Date().toISOString().slice(0, 10); // UTC YYYY-MM-DD

    const { data, error } = await admin.rpc("compute_murajaah_batch_for_date" as never, {
      p_date: today,
    } as never);

    if (error) {
      logError("murajaah-compute: compute_murajaah_batch_for_date failed", error, {
        tag: "cron", actionName: "cron.murajaah-compute",
      });
      return NextResponse.json({ error: "compute failed" }, { status: 500 });
    }

    const row = (Array.isArray(data) ? data[0] : data) as
      | { students_processed?: number; rows_scheduled?: number }
      | null
      | undefined;
    return NextResponse.json({
      ok: true,
      date: today,
      students_processed: row?.students_processed ?? 0,
      rows_scheduled: row?.rows_scheduled ?? 0,
    });
  },
);
