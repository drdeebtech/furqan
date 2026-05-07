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
import { withCronMonitor } from "@/lib/sentry/cron";
import { logError } from "@/lib/logger";

// Same constant-time secret comparison as audit-cleanup. Inlined rather
// than imported because it's defined locally in each cron route.
function safeCompare(a: string | null, b: string | undefined): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

export const GET = withCronMonitor(
  "cron-murajaah-due",
  "0 9 * * *",
  async (request: Request) => {
    const cronAuth = request.headers.get("authorization");
    const expectedCron = `Bearer ${process.env.CRON_SECRET}`;
    const cronOk = !!process.env.CRON_SECRET && cronAuth === expectedCron;

    const n8nSecret = request.headers.get("X-N8N-Secret");
    const n8nOk = safeCompare(n8nSecret, process.env.N8N_WEBHOOK_SECRET);

    if (!cronOk && !n8nOk) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = createAdminClient();
    const todayStartIso = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
    const thirtyDaysAgoIso = new Date(Date.now() - 30 * 86400_000).toISOString();

    // 1. Find ACTIVE students — at least one progress entry in last 30
    //    days. This filters out brand-new accounts (don't pester them
    //    on day 0) and dormant accounts (would be re-engagement spam).
    const { data: activeProgress } = await admin
      .from("student_progress")
      .select("student_id")
      .gte("created_at", thirtyDaysAgoIso)
      .returns<{ student_id: string }[]>();

    const activeStudentIds = [...new Set((activeProgress ?? []).map((r) => r.student_id))];
    if (activeStudentIds.length === 0) {
      return NextResponse.json({ ok: true, sent: 0, reason: "no active students" });
    }

    // 2. Of those, find who already logged study TODAY. Skip them.
    const { data: loggedToday } = await admin
      .from("study_log")
      .select("student_id")
      .gte("started_at", todayStartIso)
      .in("student_id", activeStudentIds)
      .returns<{ student_id: string }[]>();

    const loggedTodaySet = new Set((loggedToday ?? []).map((r) => r.student_id));
    const dueIds = activeStudentIds.filter((id) => !loggedTodaySet.has(id));

    if (dueIds.length === 0) {
      return NextResponse.json({ ok: true, sent: 0, reason: "all active students already logged today" });
    }

    // 3. Fan out notifications. notify() is async; we await each so a
    //    single failure doesn't silently drop the rest. Errors get
    //    logged but the loop continues — partial success is better
    //    than full abort.
    let sent = 0;
    let failed = 0;
    for (const studentId of dueIds) {
      try {
        await notify({
          userId: studentId,
          type: "system",
          title: "تذكير المراجعة اليومية",
          body: "حافظ على سلسلتك — راجع جزءاً من القرآن أو سجّل دراستك اليوم.",
        });
        sent += 1;
      } catch (err) {
        failed += 1;
        logError("murajaah-due: notify failed", err, {
          tag: "murajaah-due",
          metadata: { studentId },
        });
      }
    }

    return NextResponse.json({
      ok: true,
      activeStudents: activeStudentIds.length,
      loggedTodayCount: loggedTodaySet.size,
      sent,
      failed,
      at: new Date().toISOString(),
    });
  },
);
