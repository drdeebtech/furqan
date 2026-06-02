// Supabase Edge Function: no-show-detector
// Detects confirmed bookings where the session time has passed
// but neither participant joined within 15 minutes of scheduled time
// Cron: every 15 minutes

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req: Request) => {
  const cronSecret = Deno.env.get("CRON_SECRET");
  const authHeader = req.headers.get("authorization");
  const expected = cronSecret ? `Bearer ${cronSecret}` : null;

  const authorized =
    !!expected &&
    !!authHeader &&
    authHeader.length === expected.length &&
    authHeader === expected;

  if (!authorized) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const now = new Date();
  // Look for confirmed bookings where scheduled_at + 15 min < now
  const cutoff = new Date(now.getTime() - 15 * 60 * 1000).toISOString();
  let flagged = 0;

  const { data: bookings } = await supabase
    .from("bookings")
    .select("id, student_id, teacher_id, scheduled_at, duration_min")
    .eq("status", "confirmed")
    .lte("scheduled_at", cutoff);

  if (!bookings || bookings.length === 0) {
    return new Response(JSON.stringify({ ok: true, flagged: 0 }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  for (const booking of bookings) {
    // Check if session exists and anyone joined
    const { data: session } = await supabase
      .from("sessions")
      .select("id, teacher_joined, student_joined, started_at")
      .eq("booking_id", booking.id)
      .maybeSingle();

    // If no session exists, or nobody joined
    if (!session || (!session.teacher_joined && !session.student_joined && !session.started_at)) {
      // Mark as no_show
      await supabase
        .from("bookings")
        .update({
          status: "no_show",
          cancel_reason: "لم يحضر أحد — تم الكشف تلقائياً",
        })
        .eq("id", booking.id);

      if (session) {
        await supabase
          .from("sessions")
          .update({ ended_at: now.toISOString() })
          .eq("id", session.id);
      }

      // Notify both
      const notifs = [booking.student_id, booking.teacher_id].map((uid) => ({
        user_id: uid,
        type: "system",
        title: "تم تسجيل غياب عن الجلسة",
        body: "لم يتم الانضمام للجلسة المحددة في الوقت المناسب — تم تسجيل غياب تلقائياً",
        data: { booking_id: booking.id },
        channel: ["in_app"],
      }));
      await supabase.from("notifications").insert(notifs);

      flagged++;
    }
  }

  return new Response(JSON.stringify({ ok: true, flagged }), {
    headers: { "Content-Type": "application/json" },
  });
});
