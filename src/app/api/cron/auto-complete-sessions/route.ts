import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withAuthedCronMonitor } from "@/lib/sentry/cron";
import { emitEvent } from "@/lib/automation/emit";
import { notify } from "@/lib/notifications/dispatcher";
import { finalizeAttendance } from "@/lib/domains/attendance/finalize";
import { awardAchievement } from "@/lib/domains/achievements/award";
import { notifyParentSessionComplete } from "@/lib/notifications/parent";
import { logError } from "@/lib/logger";

// Non-human actor id for calls that record "who triggered this" — the same
// service-actor sentinel used by the n8n-triggered parent-report route
// (src/app/api/reports/session/[id]/send/route.ts).
const CRON_ACTOR_ID = "00000000-0000-0000-0000-000000000000";

export const dynamic = "force-dynamic";

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
export const GET = withAuthedCronMonitor(
  "cron-auto-complete-sessions",
  "*/15 * * * *",
  async () => {
    // admin: cron — no user session; cross-user session completion (issue #523)
    const admin = createAdminClient();
    const now = new Date();

    const { data: sessions, error: sessionsErr } = await admin
      .from("sessions")
      .select("id, booking_id, started_at, teacher_joined, student_joined")
      .not("started_at", "is", null)
      .is("ended_at", null);

    if (sessionsErr) {
      throw new Error(`auto-complete-sessions: select sessions: ${sessionsErr.message}`);
    }

    const rows = (sessions ?? []) as {
      id: string;
      booking_id: string;
      started_at: string;
      teacher_joined: boolean | null;
      student_joined: boolean | null;
    }[];
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
    let closedNoTeacher = 0;

    for (const session of rows) {
      const booking = bookingMap[session.booking_id];
      if (!booking) continue;

      const elapsedMin = (now.getTime() - new Date(session.started_at).getTime()) / 60000;
      if (elapsedMin <= booking.duration_min * 2) continue;

      const actualDuration = Math.round(elapsedMin);
      const teacherAttended = session.teacher_joined === true;

      try {
        // Always close the stranded session so the ghost timer clears.
        const { error: sessionUpdateErr } = await admin
          .from("sessions")
          .update({
            ended_at: now.toISOString(),
            actual_duration: actualDuration,
          })
          .eq("id", session.id)
          .is("ended_at", null);
        if (sessionUpdateErr) throw sessionUpdateErr;

        if (!teacherAttended) {
          // F3: the teacher never joined, so this is NOT a real completed
          // lecture. Completing the booking would fire t_inc_teacher_sessions —
          // recognizing revenue + a session count for a session that never
          // happened, driven only by a student-settable `started_at`. Close the
          // ghost, leave the booking status untouched, and log for ops review.
          // A genuine teacher no-show is adjudicated out of band, never by
          // silently marking the booking completed.
          await admin
            .from("audit_log")
            .insert({
              table_name: "sessions",
              record_id: session.id,
              action: "UPDATE",
              old_data: { ended_at: null },
              new_data: { ended_at: now.toISOString(), actual_duration: actualDuration },
              reason: "إغلاق تلقائي — لم ينضم المعلّم؛ لم تُحتسب جلسة مكتملة",
            } as never)
            .then(({ error }) => {
              if (error) {
                logError("auto-complete-sessions: audit insert failed", error, {
                  tag: "cron-auto-complete-sessions",
                  metadata: { session_id: session.id },
                });
              }
            });
          logError(
            "auto-complete-sessions: closed stranded session without teacher presence — booking NOT completed",
            null,
            {
              tag: "cron-auto-complete-sessions",
              metadata: { session_id: session.id, booking_id: session.booking_id },
            },
          );
          closedNoTeacher++;
          continue;
        }

        const { error: bookingUpdateErr } = await admin
          .from("bookings")
          .update({ status: "completed" })
          .eq("id", session.booking_id);
        if (bookingUpdateErr) throw bookingUpdateErr;

        // F4: accrue teacher payroll (session_deliveries) for a genuinely
        // attended session. Only when BOTH parties actually joined do we mark it
        // 'present' — finalize_attendance pays the teacher only for a 'present'
        // outcome, and this automated path has no human attestation, so we
        // require positive attendance evidence rather than guess (a teacher-only
        // presence is left for out-of-band admin adjudication). Idempotent (NOT
        // EXISTS guard on session_deliveries) + best-effort: a payroll hiccup
        // must never block the session cleanup above.
        if (session.student_joined === true) {
          await finalizeAttendance(admin, session.booking_id, "present").catch((err) =>
            logError("auto-complete-sessions: finalizeAttendance(present) failed", err, {
              tag: "cron-auto-complete-sessions",
              metadata: { session_id: session.id, booking_id: session.booking_id },
            }),
          );
        }

        // Drift fix: this branch is the cron's own teacher-attended
        // completion path (kept separate from endSession — see the module
        // header comment for why full delegation is out of scope). It had
        // fallen out of sync with endSession's post-commit steps (src/lib/
        // domains/session/orchestrate.ts), silently skipping the
        // first_session badge and the parent report for any session closed
        // by this cron instead of a manual "End Session". Same best-effort
        // shape as endSession: never block cleanup on these.
        await awardAchievement(booking.student_id, "first_session").catch((err) =>
          logError("auto-complete-sessions: first_session award failed", err, {
            tag: "achievements",
          }),
        );

        try {
          await notifyParentSessionComplete(session.id, CRON_ACTOR_ID);
        } catch (err) {
          logError("auto-complete-sessions: notifyParentSessionComplete failed", err, {
            tag: "cron-auto-complete-sessions",
            metadata: { student_id: booking.student_id, session_id: session.id },
          });
        }

        // Route through the dispatcher (P3 #345) so preference / quiet-hours
        // gating + delivery logging apply — never a direct notifications insert.
        await Promise.allSettled(
          [booking.student_id, booking.teacher_id].map((uid) =>
            notify({
              userId: uid,
              type: "system",
              title: "تم إنهاء الجلسة تلقائياً",
              body: `تم إنهاء الجلسة تلقائياً بعد تجاوز الوقت المحدد — المدة: ${actualDuration} دقيقة`,
              entityType: "session",
              entityId: session.id,
            }),
          ),
        ).then((results) => {
          for (const r of results) {
            if (r.status === "rejected") {
              logError("auto-complete-sessions: notify failed", r.reason, {
                tag: "cron-auto-complete-sessions",
                metadata: { session_id: session.id },
              });
            }
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
      closedNoTeacher,
      scanned: rows.length,
      at: now.toISOString(),
    });
  },
);
