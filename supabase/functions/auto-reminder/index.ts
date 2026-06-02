// Supabase Edge Function: auto-reminder
// Sends session reminders 24h and 1h before scheduled time
// Cron: every 30 minutes

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

  // 24h window: sessions between 23.5h and 24.5h from now
  const h24Start = new Date(now.getTime() + 23.5 * 60 * 60 * 1000).toISOString();
  const h24End = new Date(now.getTime() + 24.5 * 60 * 60 * 1000).toISOString();

  // 1h window: sessions between 0.5h and 1.5h from now
  const h1Start = new Date(now.getTime() + 0.5 * 60 * 60 * 1000).toISOString();
  const h1End = new Date(now.getTime() + 1.5 * 60 * 60 * 1000).toISOString();

  let sent = 0;

  for (const { start, end, label } of [
    { start: h24Start, end: h24End, label: "24 ساعة" },
    { start: h1Start, end: h1End, label: "ساعة واحدة" },
  ]) {
    const { data: bookings } = await supabase
      .from("bookings")
      .select("id, student_id, teacher_id, scheduled_at")
      .eq("status", "confirmed")
      .gte("scheduled_at", start)
      .lte("scheduled_at", end);

    if (!bookings) continue;

    for (const b of bookings) {
      const dateStr = new Date(b.scheduled_at).toLocaleString("ar-SA");
      const notifs = [b.student_id, b.teacher_id].map((uid) => ({
        user_id: uid,
        type: "reminder",
        title: `تذكير: جلسة خلال ${label}`,
        body: `لديك جلسة بتاريخ ${dateStr}`,
        data: { booking_id: b.id },
        channel: ["in_app"],
      }));

      await supabase.from("notifications").insert(notifs);
      sent += 2;
    }
  }

  return new Response(JSON.stringify({ ok: true, sent }), {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
});
