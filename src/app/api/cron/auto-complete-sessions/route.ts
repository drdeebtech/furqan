import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { withCronMonitor } from "@/lib/sentry/cron";
import { emitEvent } from "@/lib/automation/emit";
import { logError } from "@/lib/logger";

export const dynamic = "force-dynamic";

function safeCompare(a: string | null, b: string | undefined): boolean {
  if (!a || !b) return false;
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

/**
 * Closes "stranded" sessions — those where started_at is set but ended_at is
 * null long after the booking should have ended. Without this safety net the
 * Live Sessions widgets show ghosts (e.g. a 56-hour timer against a 30-min
 * booking) because the only normal path that sets ended_at is the teacher
 * manually pressing "إنهاء الجلسة"; participants leaving the Daily room does
 * NOT end the session by design (see student/sessions/[id]/actions.ts).
 *
 * Threshold: elapsed_min > duration_min * 2. Mirrors the cutoff that lived in
 * the now-deleted supabase/functions/auto-complete edge function.
 *
 * Trigger: n8n (Mac mini) every 15 minutes via Schedule node hitting this URL
 * with the `X-N8N-Secret` header set to N8N_WEBHOOK_SECRET. Same dual-auth
 * shape as audit-cleanup; CRON_SECRET is also accepted for manual invocation.
 *
 * Per-session error handling: an individual session's failure is logged and
 * skipped so the batch drains. The route only throws on the initial fetch
 * errors (sessions/bookings) so Sentry's monitor marks the run failed when
 * the whole job is broken, not when one row hiccups.
 */
export const GET = withCronMonitor(
  "cron-auto-complete-sessions",
  "*/15 * * * *",
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
    const now = new Date();

    const { data: sessions, error: sessionsErr } = await admin
      .from("sessions")
      .select("id, booking_id, started_at")
      .not("started_at", "is", null)
      .is("ended_at", null);

    if (sessionsErr) {
      throw new Error(`auto-complete-sessions: select sessions: ${sessionsErr.message}`);
    }

    const rows = (sessions ?? []) as { id: string; booking_id: string; started_at: string }[];
    if (rows.length === 0) {
      return NextResponse.json({ ok: true, ended: 0, scanned: 0, at: now.toISOString() });
    }

    const bookingIds = rows.map((s) => s.booking_id);
    const { data: bookings, error: bookingsErr } = await admin
      .from("bookings")
      .select("id, duration_min, student_id, teacher_id")
      .in("id", bookingIds);

    if (bookingsErr) {
      throw new Error(`auto-complete-sessions: select bookings: ${bookingsErr.message}`);
    }

    const bookingMap = Object.fromEntries(
      ((bookings ?? []) as { id: string; duration_min: number; student_id: string; teacher_id: string }[])
        .map((b) => [b.id, b]),
    );

    let ended = 0;

    for (const session of rows) {
      const booking = bookingMap[session.booking_id];
      if (!booking) continue;

      const elapsedMin = (now.getTime() - new Date(session.started_at).getTime()) / 60000;
      if (elapsedMin <= booking.duration_min * 2) continue;

      const actualDuration = Math.round(elapsedMin);

      try {
        const { error: sessionUpdateErr } = await admin
          .from("sessions")
          .update({
            ended_at: now.toISOString(),
            actual_duration: actualDuration,
          })
          .eq("id", session.id)
          .is("ended_at", null);
        if (sessionUpdateErr) throw sessionUpdateErr;

        const { error: bookingUpdateErr } = await admin
          .from("bookings")
          .update({ status: "completed" } as never)
          .eq("id", session.booking_id);
        if (bookingUpdateErr) throw bookingUpdateErr;

        const notifs = [booking.student_id, booking.teacher_id].map((uid) => ({
          user_id: uid,
          type: "system",
          title: "تم إنهاء الجلسة تلقائياً",
          body: `تم إنهاء الجلسة تلقائياً بعد تجاوز الوقت المحدد — المدة: ${actualDuration} دقيقة`,
          channel: ["in_app"],
        }));
        await admin
          .from("notifications")
          .insert(notifs as never)
          .then(({ error }) => {
            if (error) {
              logError("auto-complete-sessions: notifications insert failed", error, {
                tag: "cron-auto-complete-sessions",
                metadata: { session_id: session.id },
              });
            }
          });

        await admin
          .from("audit_log")
          .insert({
            table_name: "sessions",
            record_id: session.id,
            action: "UPDATE",
            old_data: { ended_at: null },
            new_data: { ended_at: now.toISOString(), actual_duration: actualDuration },
            reason: "إنهاء تلقائي — تجاوز الوقت المحدد",
          } as never)
          .then(({ error }) => {
            if (error) {
              logError("auto-complete-sessions: audit insert failed", error, {
                tag: "cron-auto-complete-sessions",
                metadata: { session_id: session.id },
              });
            }
          });

        await emitEvent(
          "session.auto_completed",
          "session",
          session.id,
          {
            booking_id: session.booking_id,
            actual_duration_min: actualDuration,
            elapsed_min: Math.round(elapsedMin),
          },
        ).catch((err) =>
          logError("auto-complete-sessions: emitEvent failed", err, {
            tag: "automation",
            event: "session.auto_completed",
            metadata: { session_id: session.id },
          }),
        );

        ended++;
      } catch (err) {
        logError("auto-complete-sessions: session close failed — skipping", err, {
          tag: "cron-auto-complete-sessions",
          metadata: { session_id: session.id, booking_id: session.booking_id },
        });
      }
    }

    return NextResponse.json({
      ok: true,
      ended,
      scanned: rows.length,
      at: now.toISOString(),
    });
  },
);
