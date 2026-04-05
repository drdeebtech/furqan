"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createRoom, deleteRoom } from "@/lib/daily";

/* ── Row types for query results ──────────────────────────────────────────── */

interface ProfileRole { role: string }
interface SessionForEnd { id: string; booking_id: string; started_at: string | null; ended_at: string | null; actual_duration: number | null; teacher_joined: boolean; student_joined: boolean }
interface BookingForRoom { id: string; scheduled_at: string; duration_min: number; student_id: string; teacher_id: string }
interface SessionForRecreate { id: string; room_name: string; booking_id: string; expires_at: string | null; room_url: string }
interface BookingSchedule { scheduled_at: string; duration_min: number }
interface BookingParties { student_id: string; teacher_id: string }
interface SessionExisting { id: string }

/* ── helper: verify caller is admin ───────────────────────────────────────── */

async function requireAdmin(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("غير مسجل الدخول");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single()
    .then((r) => ({ data: r.data as ProfileRole | null }));

  if (!profile || profile.role !== "admin") throw new Error("غير مصرح");
  return user;
}

/* ── forceEndSession ──────────────────────────────────────────────────────── */

export async function forceEndSession(sessionId: string, reason: string) {
  const supabase = await createClient();
  const user = await requireAdmin(supabase);

  /* Fetch session */
  const { data: session } = await supabase
    .from("sessions")
    .select("id, booking_id, started_at, ended_at, actual_duration, teacher_joined, student_joined")
    .eq("id", sessionId)
    .single()
    .then((r) => ({ data: r.data as SessionForEnd | null }));

  if (!session) return { error: "الجلسة غير موجودة" };
  if (session.ended_at) return { error: "الجلسة منتهية بالفعل" };
  if (!session.started_at) return { error: "الجلسة لم تبدأ بعد" };

  const now = new Date().toISOString();
  const actualDuration = Math.round(
    (new Date(now).getTime() - new Date(session.started_at).getTime()) / 60000,
  );

  const oldData = {
    ended_at: session.ended_at,
    actual_duration: session.actual_duration,
  };
  const newData = { ended_at: now, actual_duration: actualDuration };

  /* Update session */
  const { error: updateErr } = await supabase
    .from("sessions")
    .update({ ended_at: now, actual_duration: actualDuration } as never)
    .eq("id", sessionId);

  if (updateErr) return { error: "فشل إنهاء الجلسة" };

  /* Update booking status */
  await supabase
    .from("bookings")
    .update({ status: "completed" } as never)
    .eq("id", session.booking_id);

  /* Audit log */
  await supabase.from("audit_log").insert({
    changed_by: user.id,
    table_name: "sessions",
    record_id: sessionId,
    action: "UPDATE",
    old_data: oldData,
    new_data: newData,
    reason,
  } as never);

  /* Notify teacher + student */
  const { data: booking } = await supabase
    .from("bookings")
    .select("student_id, teacher_id")
    .eq("id", session.booking_id)
    .single()
    .then((r) => ({ data: r.data as BookingParties | null }));

  if (booking) {
    const notifs = [booking.student_id, booking.teacher_id].map((uid) => ({
      user_id: uid,
      type: "system",
      title: "تم إنهاء الجلسة",
      body: reason || "تم إنهاء الجلسة بواسطة المسؤول",
      channel: ["in_app"],
    }));
    await supabase.from("notifications").insert(notifs as never);
  }

  revalidatePath("/admin/sessions");
  revalidatePath("/admin/sessions/live");
  return { success: true };
}

/* ── adminCreateRoom ──────────────────────────────────────────────────────── */

export async function adminCreateRoom(bookingId: string) {
  const supabase = await createClient();
  const user = await requireAdmin(supabase);

  /* Fetch booking */
  const { data: booking } = await supabase
    .from("bookings")
    .select("id, scheduled_at, duration_min, student_id, teacher_id")
    .eq("id", bookingId)
    .single()
    .then((r) => ({ data: r.data as BookingForRoom | null }));

  if (!booking) return { error: "الحجز غير موجود" };

  /* Check existing session */
  const { data: existing } = await supabase
    .from("sessions")
    .select("id")
    .eq("booking_id", bookingId)
    .maybeSingle()
    .then((r) => ({ data: r.data as SessionExisting | null }));

  if (existing) return { error: "يوجد جلسة لهذا الحجز بالفعل" };

  /* Create Daily room */
  const roomName = `furqan-${crypto.randomUUID().replace(/-/g, "")}`;
  const expiresAt = new Date(
    new Date(booking.scheduled_at).getTime() + (booking.duration_min + 30) * 60 * 1000,
  );

  let room;
  try {
    room = await createRoom(roomName, expiresAt);
  } catch {
    return { error: "فشل إنشاء غرفة الفيديو" };
  }

  /* Insert session */
  const { error: insertErr } = await supabase.from("sessions").insert({
    booking_id: bookingId,
    room_name: room.name,
    room_url: room.url,
    expires_at: expiresAt.toISOString(),
    created_via: "manual",
  } as never);

  if (insertErr) return { error: "فشل إنشاء الجلسة" };

  /* Audit log */
  await supabase.from("audit_log").insert({
    changed_by: user.id,
    table_name: "sessions",
    record_id: bookingId,
    action: "INSERT",
    old_data: null,
    new_data: { room_name: room.name, room_url: room.url, created_via: "manual" },
    reason: "إنشاء غرفة يدوي بواسطة المسؤول",
  } as never);

  revalidatePath("/admin/sessions");
  return { success: true };
}

/* ── adminRecreateRoom ────────────────────────────────────────────────────── */

export async function adminRecreateRoom(sessionId: string) {
  const supabase = await createClient();
  const user = await requireAdmin(supabase);

  /* Fetch session */
  const { data: session } = await supabase
    .from("sessions")
    .select("id, room_name, booking_id, expires_at, room_url")
    .eq("id", sessionId)
    .single()
    .then((r) => ({ data: r.data as SessionForRecreate | null }));

  if (!session) return { error: "الجلسة غير موجودة" };

  /* Fetch booking for duration */
  const { data: booking } = await supabase
    .from("bookings")
    .select("scheduled_at, duration_min")
    .eq("id", session.booking_id)
    .single()
    .then((r) => ({ data: r.data as BookingSchedule | null }));

  if (!booking) return { error: "الحجز غير موجود" };

  /* Try to delete old room */
  try {
    await deleteRoom(session.room_name);
  } catch {
    /* ignore – room may already be gone */
  }

  /* Create new room */
  const newRoomName = `furqan-${crypto.randomUUID().replace(/-/g, "")}`;
  const newExpiresAt = new Date(Date.now() + (booking.duration_min + 30) * 60 * 1000);

  let room;
  try {
    room = await createRoom(newRoomName, newExpiresAt);
  } catch {
    return { error: "فشل إنشاء غرفة الفيديو الجديدة" };
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

  /* Update session */
  const { error: updateErr } = await supabase
    .from("sessions")
    .update({
      room_name: room.name,
      room_url: room.url,
      expires_at: newExpiresAt.toISOString(),
    } as never)
    .eq("id", sessionId);

  if (updateErr) return { error: "فشل تحديث الجلسة" };

  /* Audit log */
  await supabase.from("audit_log").insert({
    changed_by: user.id,
    table_name: "sessions",
    record_id: sessionId,
    action: "UPDATE",
    old_data: oldData,
    new_data: newData,
    reason: "إعادة إنشاء غرفة بواسطة المسؤول",
  } as never);

  revalidatePath("/admin/sessions");
  return { success: true };
}
