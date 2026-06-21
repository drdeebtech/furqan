/**
 * Sprint 3.2 (2026-05-05) — Daily Murajaah-due cron endpoint.
 *
 * Designed to be triggered ONCE PER DAY by an n8n cron on
 * n8n.drdeeb.tech (NOT vercel.json crons — Hobby plan caps those at
 * daily-only and we already have 3 daily Vercel crons; n8n is the
 * canonical scheduler per CLAUDE.md).
 *
 * What it does:
 *   1. Find every student who is "active" (has at least one
 *      student_progress row in the last 30 days) but hasn't logged
 *      study time today. These are the students whose streak is
 *      either dormant or about to break.
 *   2. Send each of them a daily-review reminder via the existing
 *      `notify()` dispatcher. Notification type='system'; deep-links
 *      to /student/dashboard where the Murajaah card surfaces the
 *      day's review windows.
 *
 * Auth: same dual-pattern as audit-cleanup — Authorization Bearer
 * CRON_SECRET (Vercel-style) OR X-N8N-Secret header (n8n direct).
 *
 * To wire on n8n.drdeeb.tech:
 *   1. Create a new Cron workflow, schedule "0 9 * * *" (09:00 UTC daily)
 *   2. Add an HTTP Request node:
 *        URL: https://www.furqan.today/api/cron/murajaah-due
 *        Method: GET
 *        Headers: { "X-N8N-Secret": "{{ $env.N8N_WEBHOOK_SECRET }}" }
 *   3. Activate the workflow
 *
 * The endpoint returns JSON with the count of notifications sent so the
 * n8n run can log success/failure.
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notify } from "@/lib/notifications/dispatcher";
import { withAuthedCronMonitor } from "@/lib/sentry/cron";
import { logError } from "@/lib/logger";

export const GET = withAuthedCronMonitor(
  "cron-murajaah-due",
  "0 9 * * *",
  async () => {
    const admin = createAdminClient();
    const todayStartIso = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
    const thirtyDaysAgoIso = new Date(Date.now() - 30 * 86400_000).toISOString();

    // 1. Compute the due set with a single set-based anti-join (audit H12):
    //    active in the last 30 days AND no study_log row today. The old code
    //    pulled every 30-day progress row into memory, deduped in JS, then
    //    issued a 50k-element .in() over study_log — multi-million-row reads
    //    and a ~1.8MB URL at scale.
    const { data: dueRows, error: dueErr } = await admin.rpc("murajaah_due_student_ids", {
      p_active_since: thirtyDaysAgoIso,
      p_today_start: todayStartIso,
    });
    if (dueErr) {
      logError("murajaah-due: due-set query failed", dueErr, { tag: "murajaah-due" });
      return NextResponse.json({ error: "due-set query failed" }, { status: 500 });
    }
    const dueIds = (dueRows ?? []).map((r) => r.student_id);

    if (dueIds.length === 0) {
      return NextResponse.json({ ok: true, sent: 0, reason: "no due students" });
    }

    // 2. Fan out notifications in bounded-concurrency batches so a large due
    //    set stays within the cron maxDuration instead of a slow serial loop.
    //    Each failure is logged but never aborts the batch.
    //    (Full n8n batch offload is the scale follow-up shared with H7.)
    const CONCURRENCY = 25;
    let sent = 0;
    let failed = 0;
    for (let i = 0; i < dueIds.length; i += CONCURRENCY) {
      const batch = dueIds.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map((studentId) =>
          notify({
            userId: studentId,
            type: "system",
            title: "تذكير المراجعة اليومية",
            body: "حافظ على سلسلتك — راجع جزءاً من القرآن أو سجّل دراستك اليوم.",
          }),
        ),
      );
      results.forEach((r, j) => {
        if (r.status === "fulfilled") {
          sent += 1;
        } else {
          failed += 1;
          logError("murajaah-due: notify failed", r.reason, {
            tag: "murajaah-due",
            metadata: { studentId: batch[j] },
          });
        }
      });
    }

    return NextResponse.json({
      ok: true,
      dueStudents: dueIds.length,
      sent,
      failed,
      at: new Date().toISOString(),
    });
  },
);
