// Supabase Edge Function: auto-complete
// Auto-ends sessions that have been active for more than 2x their scheduled duration
// Cron: every 15 minutes

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async () => {
  const now = new Date();
  let ended = 0;

  // Find active sessions (started but not ended)
  const { data: sessions } = await supabase
    .from("sessions")
    .select("id, booking_id, started_at")
    .not("started_at", "is", null)
    .is("ended_at", null);

  if (!sessions || sessions.length === 0) {
    return new Response(JSON.stringify({ ok: true, ended: 0 }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const bIds = sessions.map((s) => s.booking_id);
  const { data: bookings } = await supabase
    .from("bookings")
    .select("id, duration_min, student_id, teacher_id")
    .in("id", bIds);

  const bookingMap = Object.fromEntries((bookings ?? []).map((b) => [b.id, b]));

  for (const session of sessions) {
    const booking = bookingMap[session.booking_id];
    if (!booking) continue;

    const elapsed = (now.getTime() - new Date(session.started_at).getTime()) / 60000;
    const maxDuration = booking.duration_min * 2; // 2x tolerance

    if (elapsed > maxDuration) {
      const actualDuration = Math.round(elapsed);

      await supabase
        .from("sessions")
        .update({
          ended_at: now.toISOString(),
          actual_duration: actualDuration,
        })
        .eq("id", session.id);

      await supabase
        .from("bookings")
        .update({ status: "completed" })
        .eq("id", session.booking_id);

      // Notify participants
      const notifs = [booking.student_id, booking.teacher_id].map((uid) => ({
        user_id: uid,
        type: "system",
        title: "تم إنهاء الجلسة تلقائياً",
        body: `تم إنهاء الجلسة تلقائياً بعد تجاوز الوقت المحدد — المدة: ${actualDuration} دقيقة`,
        channel: ["in_app"],
      }));
      await supabase.from("notifications").insert(notifs);

      // Audit log
      await supabase.from("audit_log").insert({
        table_name: "sessions",
        record_id: session.id,
        action: "UPDATE",
        old_data: { ended_at: null },
        new_data: { ended_at: now.toISOString(), actual_duration: actualDuration },
        reason: "إنهاء تلقائي — تجاوز الوقت المحدد",
      });

      ended++;
    }
  }

  return new Response(JSON.stringify({ ok: true, ended }), {
    headers: { "Content-Type": "application/json" },
  });
});
