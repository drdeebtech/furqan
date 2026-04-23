import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ModeratorDashboardContent } from "./dashboard-content";
import { ModeratorAtRiskStudents } from "./at-risk-students";
import {
  getModeratorWeeklyCVActivity,
  getModeratorRatingDistribution,
  getModeratorFlaggedEvaluations,
  getAdminLiveSessions,
} from "@/lib/dashboard-queries";

export const metadata: Metadata = { title: "لوحة المشرف" };

export default async function ModeratorDashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [
    { count: studentCount },
    { count: teacherCount },
    { count: pendingCvCount },
    { count: activeSessionCount },
    { count: evalCount },
  ] = await Promise.all([
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "student"),
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "teacher"),
    supabase.from("teacher_profiles").select("id", { count: "exact", head: true }).eq("cv_status", "pending_review"),
    supabase.from("sessions").select("id", { count: "exact", head: true }).not("started_at", "is", null).is("ended_at", null),
    supabase.from("session_evaluations").select("id", { count: "exact", head: true }),
  ]);

  const [weeklyCVActivity, liveSessions, ratingDistribution, flaggedEvaluations] = await Promise.all([
    getModeratorWeeklyCVActivity(),
    getAdminLiveSessions(),
    getModeratorRatingDistribution(),
    getModeratorFlaggedEvaluations(),
  ]);

  return (
    <>
      <ModeratorDashboardContent
        data={{
          studentCount: studentCount ?? 0,
          teacherCount: teacherCount ?? 0,
          pendingCvCount: pendingCvCount ?? 0,
          activeSessionCount: activeSessionCount ?? 0,
          evalCount: evalCount ?? 0,
          flaggedEvalCount: flaggedEvaluations.length,
          weeklyCVActivity,
          liveSessions,
          ratingDistribution,
          flaggedEvaluations,
        }}
      />
      <div className="mx-auto max-w-6xl px-4 pb-8 sm:px-6">
        <ModeratorAtRiskStudents />
      </div>
    </>
  );
}
