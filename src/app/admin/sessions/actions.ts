"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { TableInsert, TableUpdate } from "@/lib/supabase/typed-helpers";
import { createRoom, deleteRoom, updateRoomMaxParticipants, createObserverToken, DailyApiError } from "@/lib/daily";
import { notify } from "@/lib/notifications/dispatcher";
import { logError, logWarn } from "@/lib/logger";
import { loudAction } from "@/lib/actions/loud";

/* ── Row types for query results ──────────────────────────────────────────── */

interface ProfileRole { role: string }
interface SessionForEnd { id: string; booking_id: string; started_at: string | null; ended_at: string | null; actual_duration: number | null; teacher_joined: boolean; student_joined: boolean }
interface SessionForRecreate { id: string; room_name: string; booking_id: string; expires_at: string | null; room_url: string }
interface BookingSchedule { scheduled_at: string; duration_min: number }
interface BookingParties { student_id: string; teacher_id: string }

class UserError extends Error {
  readonly userError = true;
  constructor(msg: string) { super(msg); this.name = "UserError"; }
}

/* ── helper: verify caller is admin (preserved from pre-wrap) ─────────────── */
/* Local helper — uses the passed-in supabase client to save a connection.   */
/* Behavior parity with @/lib/auth/require-admin's role check.                */

async function requireAdmin(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new UserError("غير مسجل الدخول");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single()
    .then((r) => ({ data: r.data as ProfileRole | null }));

  if (!profile || !["admin"].includes(profile.role)) throw new UserError("غير مصرح");
  return user;
}

async function adminPreflight(): Promise<{ actorId: string }> {
  const supabase = await createClient();
  const user = await requireAdmin(supabase);
  return { actorId: user.id };
}

/* ── forceEndSession ──────────────────────────────────────────────────────── */

const forceEndSessionBase = loudAction<{ sessionId: string; reason: string }, { message: string }>({
  name: "admin.sessions.force-end",
  // Terminating an active session — user-impacting + irreversible state
  // change. Worth Sentry capture without paging Telegram on every retry.
  severity: "warning",
  schema: z.object({ sessionId: z.string().uuid(), reason: z.string() }),
  audit: {
    table: "sessions",
    recordId: (i) => i.sessionId,
    action: "UPDATE",
    reasonPrefix: "admin force-end session",
  },
  preflight: adminPreflight,
  handler: async ({ sessionId, reason }, { actorId }) => {
    const supabase = await createClient();

    /* Fetch session */
    const { data: session } = await supabase
      .from("sessions")
      .select("id, booking_id, started_at, ended_at, actual_duration, teacher_joined, student_joined")
      .eq("id", sessionId)
      .single()
      .then((r) => ({ data: r.data as SessionForEnd | null }));

    if (!session) throw new UserError("الجلسة غير موجودة");
    if (session.ended_at) throw new UserError("الجلسة منتهية بالفعل");
    if (!session.started_at) throw new UserError("الجلسة لم تبدأ بعد");

    const now = new Date().toISOString();
    const actualDuration = Math.round(
      (new Date(now).getTime() - new Date(session.started_at).getTime()) / 60000,
    );

    const oldData = {
      ended_at: session.ended_at,
      actual_duration: session.actual_duration,
    };
    const newData = { ended_at: now, actual_duration: actualDuration };

    /* Order matters: update booking first, session last. The session.ended_at
     * guard above makes the session update idempotent on retry, so a
     * failed-booking-then-fresh-attempt path stays consistent. The reverse
     * order traps a partial failure forever — booking stuck in "confirmed"
     * with no way to retry because the session.ended_at guard would block. */
    const { error: bookingErr } = await supabase
      .from("bookings")
      .update({ status: "completed" } satisfies TableUpdate<"bookings">)
      .eq("id", session.booking_id);

    if (bookingErr) throw new UserError("فشل تحديث حالة الحجز");

    const { error: updateErr } = await supabase
      .from("sessions")
      .update({ ended_at: now, actual_duration: actualDuration } satisfies TableUpdate<"sessions">)
      .eq("id", sessionId);

    if (updateErr) throw new UserError("فشل إنهاء الجلسة");

    /* Diff audit row — distinct from loudAction's input-only envelope row.
     * Carries old/new ended_at + actual_duration so reconciliation scripts
     * can re-derive force-end events without parsing the envelope. */
    await supabase.from("audit_log").insert({
      changed_by: actorId,
      table_name: "sessions",
      record_id: sessionId,
      action: "UPDATE",
      old_data: oldData,
      new_data: newData,
      reason,
    } satisfies TableInsert<"audit_log">).then((r) => {
      if (r.error) logError("forceEndSession: diff audit row failed", r.error, { tag: "admin-sessions" });
    });

    /* Notify teacher + student — best-effort. */
    const { data: booking } = await supabase
      .from("bookings")
      .select("student_id, teacher_id")
      .eq("id", session.booking_id)
      .single()
      .then((r) => ({ data: r.data as BookingParties | null }));

    if (booking) {
      const title = "تم إنهاء الجلسة";
      const body = reason || "تم إنهاء الجلسة بواسطة المسؤول";
      await Promise.all(
        [booking.student_id, booking.teacher_id].map((uid) =>
          notify({
            userId: uid,
            type: "system",
            title,
            body,
            entityType: "session",
            entityId: sessionId,
          }).catch((err) =>
            logError("notify failed during admin endSession", err, {
              component: "admin.sessions.endSession",
              metadata: { uid, sessionId },
            }),
          ),
        ),
      );
    }

    revalidatePath("/admin/sessions");
    revalidatePath("/admin/sessions/live");
    return { message: "ended" };
  },
});

export async function forceEndSession(sessionId: string, reason: string) {
  const result = await forceEndSessionBase({ sessionId, reason });
  if (!result.ok) return { error: result.error };
  return { success: true };
}

/* ── adminRecreateRoom ────────────────────────────────────────────────────── */

const adminRecreateRoomBase = loudAction<{ sessionId: string }, { message: string }>({
  name: "admin.sessions.recreate-room",
  // Recovery action that disconnects anyone currently in the old room.
  // User-impacting if the existing room has live participants.
  severity: "warning",
  schema: z.object({ sessionId: z.string().uuid() }),
  audit: {
    table: "sessions",
    recordId: (i) => i.sessionId,
    action: "UPDATE",
    reasonPrefix: "admin recreate session room",
  },
  preflight: adminPreflight,
  handler: async ({ sessionId }, { actorId }) => {
    const supabase = await createClient();

    const { data: session } = await supabase
      .from("sessions")
      .select("id, room_name, booking_id, expires_at, room_url")
      .eq("id", sessionId)
      .single()
      .then((r) => ({ data: r.data as SessionForRecreate | null }));

    if (!session) throw new UserError("الجلسة غير موجودة");

    const { data: booking } = await supabase
      .from("bookings")
      .select("scheduled_at, duration_min")
      .eq("id", session.booking_id)
      .single()
      .then((r) => ({ data: r.data as BookingSchedule | null }));

    if (!booking) throw new UserError("الحجز غير موجود");

    /* Try to delete old room. 404 means it's already gone — totally fine.
     * Anything else (5xx, network failure) is a real Daily.co problem the
     * operator should know about, even though we keep recreating below. */
    try {
      await deleteRoom(session.room_name);
    } catch (err) {
      if (err instanceof DailyApiError && err.status === 404) {
        logWarn("daily.co: deleteRoom 404 — room already gone, continuing", {
          tag: "admin-sessions", roomName: session.room_name,
        });
      } else {
        logError("daily.co: deleteRoom failed (continuing with recreate)", err, {
          tag: "admin-sessions", roomName: session.room_name,
        });
      }
    }

    const newRoomName = `furqan-${crypto.randomUUID().replace(/-/g, "")}`;
    const newExpiresAt = new Date(Date.now() + (booking.duration_min + 30) * 60 * 1000);

    let room;
    try {
      room = await createRoom(newRoomName, newExpiresAt);
    } catch (err) {
      logError("recreateRoom: createRoom failed", err, { tag: "admin-sessions" });
      throw new UserError("فشل إنشاء غرفة الفيديو الجديدة");
    }

    const oldData = {
      room_name: session.room_name,
      room_url: session.room_url,
      expires_at: session.expires_at,
    };

    const newData = {
      room_name: room.name,
      room_url: room.url,
      expires_at: newExpiresAt.toISOString(),
    };

    const { error: updateErr } = await supabase
      .from("sessions")
      .update({
        room_name: room.name,
        room_url: room.url,
        expires_at: newExpiresAt.toISOString(),
      } satisfies TableUpdate<"sessions">)
      .eq("id", sessionId);

    if (updateErr) throw new UserError("فشل تحديث الجلسة");

    await supabase.from("audit_log").insert({
      changed_by: actorId,
      table_name: "sessions",
      record_id: sessionId,
      action: "UPDATE",
      old_data: oldData,
      new_data: newData,
      reason: "إعادة إنشاء غرفة بواسطة المسؤول",
    } satisfies TableInsert<"audit_log">).then((r) => {
      if (r.error) logError("recreateRoom: diff audit row failed", r.error, { tag: "admin-sessions" });
    });

    revalidatePath("/admin/sessions");
    return { message: "recreated" };
  },
});

export async function adminRecreateRoom(sessionId: string) {
  const result = await adminRecreateRoomBase({ sessionId });
  if (!result.ok) return { error: result.error };
  return { success: true };
}

/* ── joinAsObserver — DEFERRED from loudAction wrap ───────────────────────── */
/* Returns { success, token, roomUrl } — token + roomUrl are sensitive       */
/* payload data the caller needs to navigate to the Daily.co room.           */
/* loudAction's Output type is constrained to { message?: string }, so this  */
/* dual-channel return doesn't fit cleanly. Two options for future work:     */
/*   (a) extend loudAction to support typed Output payloads (framework PR),  */
/*   (b) split into two server actions: a wrapped one that records the       */
/*       observer + a thin token-mint wrapper that doesn't write DB.         */
/* For now: kept loud-by-hand (logError on every failure path) + manual      */
/* audit_log row added in this PR (was previously missing — real silent-     */
/* fail surface).                                                             */

interface SessionForObserve { id: string; booking_id: string; room_name: string; room_url: string; expires_at: string | null; is_observable: boolean; ended_at: string | null }

export async function joinAsObserver(sessionId: string) {
  const supabase = await createClient();
  let user;
  try {
    user = await requireAdmin(supabase);
  } catch (err) {
    if (err instanceof UserError) return { error: err.message };
    logError("joinAsObserver: auth failed unexpectedly", err, { tag: "admin-sessions" });
    return { error: "غير مصرح" };
  }

  const { data: session } = await supabase
    .from("sessions")
    .select("id, booking_id, room_name, room_url, expires_at, is_observable, ended_at")
    .eq("id", sessionId)
    .single()
    .then(r => ({ data: r.data as SessionForObserve | null }));

  if (!session) return { error: "الجلسة غير موجودة" };
  if (session.ended_at) return { error: "الجلسة منتهية" };
  if (!session.is_observable) return { error: "هذه الجلسة غير قابلة للمراقبة" };

  try {
    await updateRoomMaxParticipants(session.room_name, 3);
  } catch (err) {
    logError("joinAsObserver: updateRoomMaxParticipants failed", err, { tag: "admin-sessions" });
    return { error: "فشل تحديث إعدادات الغرفة" };
  }

  const expiresAt = session.expires_at ? new Date(session.expires_at) : new Date(Date.now() + 2 * 60 * 60 * 1000);
  let token: string;
  try {
    token = await createObserverToken(session.room_name, "مراقب", expiresAt);
  } catch (err) {
    logError("joinAsObserver: createObserverToken failed", err, { tag: "admin-sessions" });
    return { error: "فشل إنشاء رمز المراقبة" };
  }

  const { error: obsSessionErr } = await supabase.from("sessions").update({
    admin_observer_id: user.id,
    observer_joined_at: new Date().toISOString(),
  } satisfies TableUpdate<"sessions">).eq("id", sessionId);

  if (obsSessionErr) {
    logError("joinAsObserver: sessions.update failed", obsSessionErr, { tag: "admin-sessions" });
    return { error: "فشل تسجيل المراقب على الجلسة" };
  }

  const { error: obsInsertErr } = await supabase.from("session_observers").insert({
    session_id: sessionId,
    observer_id: user.id,
    joined_at: new Date().toISOString(),
  } satisfies TableInsert<"session_observers">);

  if (obsInsertErr) {
    logError("joinAsObserver: session_observers.insert failed", obsInsertErr, { tag: "admin-sessions" });
    return { error: "فشل إنشاء سجل المراقبة" };
  }

  /* Audit row — added in PR 16. The unwrapped action previously had no
   * audit trail; this fills the gap pending a framework-level fix to
   * loudAction's Output constraint (see comment above the function). */
  await supabase.from("audit_log").insert({
    changed_by: user.id,
    table_name: "session_observers",
    record_id: sessionId,
    action: "INSERT",
    old_data: null,
    new_data: { session_id: sessionId, observer_id: user.id },
    reason: "admin joined session as observer",
  } satisfies TableInsert<"audit_log">).then((r) => {
    if (r.error) logError("joinAsObserver: audit row failed", r.error, { tag: "admin-sessions" });
  });

  revalidatePath("/admin/sessions");
  revalidatePath("/admin/sessions/live");
  return { success: true, token, roomUrl: session.room_url };
}
