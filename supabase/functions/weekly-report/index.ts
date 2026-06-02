// Supabase Edge Function: weekly-report
// Generates a weekly admin summary notification
// Cron: every Sunday at 8:00 AM UTC

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const CORS_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
};

Deno.serve(async (req: Request) => {
  const cronSecret = Deno.env.get("CRON_SECRET");
  const authHeader = req.headers.get("authorization");
  const expected = cronSecret ? `Bearer ${cronSecret}` : null;

  if (!expected || authHeader !== expected) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: CORS_HEADERS,
    });
  }

  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Gather weekly stats
  const [
    { count: newUsers },
    { count: completedSessions },
    { count: cancelledBookings },
    { count: noShows },
    { count: newBookings },
  ] = await Promise.all([
    supabase.from("profiles").select("id", { count: "exact", head: true }).gte("created_at", weekAgo),
    supabase.from("bookings").select("id", { count: "exact", head: true }).eq("status", "completed").gte("created_at", weekAgo),
    supabase.from("bookings").select("id", { count: "exact", head: true }).eq("status", "cancelled").gte("created_at", weekAgo),
    supabase.from("bookings").select("id", { count: "exact", head: true }).eq("status", "no_show").gte("created_at", weekAgo),
    supabase.from("bookings").select("id", { count: "exact", head: true }).gte("created_at", weekAgo),
  ]);

  const summary = [
    `مستخدمون جدد: ${newUsers ?? 0}`,
    `حجوزات جديدة: ${newBookings ?? 0}`,
    `جلسات مكتملة: ${completedSessions ?? 0}`,
    `حجوزات ملغاة: ${cancelledBookings ?? 0}`,
    `حالات غياب: ${noShows ?? 0}`,
  ].join("\n");

  // Find all admins
  const { data: admins } = await supabase
    .from("profiles")
    .select("id")
    .eq("role", "admin")
    .eq("is_active", true);

  if (admins && admins.length > 0) {
    const notifs = admins.map((admin) => ({
      user_id: admin.id,
      type: "system",
      title: "التقرير الأسبوعي",
      body: summary,
      channel: ["in_app"],
    }));
    await supabase.from("notifications").insert(notifs);
  }

  return new Response(JSON.stringify({ ok: true, summary }), {
    headers: CORS_HEADERS,
  });
});
