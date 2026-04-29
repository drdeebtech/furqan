import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isFeatureEnabled } from "@/lib/settings";
import { TimeTrackerView } from "./time-tracker-view";

export const metadata: Metadata = { title: "تتبع الوقت" };

export default async function StudentTimeTrackerPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  if (!(await isFeatureEnabled("time_tracker_enabled"))) {
    redirect("/student/dashboard");
  }

  // Open session (stopwatch currently running) — at most 1 per student.
  const { data: openRow } = await supabase
    .from("study_log")
    .select("id, started_at, kind, notes")
    .eq("student_id", user.id)
    .is("ended_at", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .returns<{ id: string; started_at: string; kind: string; notes: string | null }[]>();
  const openSession = openRow?.[0] ?? null;

  // Last 20 closed entries
  const { data: history } = await supabase
    .from("study_log")
    .select("id, started_at, ended_at, duration_seconds, kind, notes")
    .eq("student_id", user.id)
    .not("ended_at", "is", null)
    .order("started_at", { ascending: false })
    .limit(20)
    .returns<{ id: string; started_at: string; ended_at: string | null; duration_seconds: number; kind: string; notes: string | null }[]>();

  // Aggregate this-week study-time so the page shows a quick summary.
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const { data: weekRows } = await supabase
    .from("study_log")
    .select("duration_seconds")
    .eq("student_id", user.id)
    .not("ended_at", "is", null)
    .gte("started_at", sevenDaysAgo.toISOString())
    .returns<{ duration_seconds: number }[]>();
  const weekSeconds = (weekRows ?? []).reduce((acc, r) => acc + r.duration_seconds, 0);

  return (
    <TimeTrackerView
      openSession={openSession}
      history={history ?? []}
      weekSeconds={weekSeconds}
    />
  );
}
