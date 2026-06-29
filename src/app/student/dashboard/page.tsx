import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { StudentDashboardContent } from "./dashboard-content";
import { DataLoadBanner } from "@/components/shared/data-load-banner";
import { studentDashboardView } from "@/lib/views/student-dashboard";
import { StudentAnalyticsSection, StudentAnalyticsSkeleton } from "./analytics-section";
import { StudentMurajaahSection, StudentMurajaahSkeleton } from "./murajaah-section";

export const metadata: Metadata = { title: "لوحتي" };

interface PageProps {
  searchParams: Promise<{ year?: string }>;
}

export default async function StudentDashboardPage({ searchParams }: PageProps) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Issue #545 — onboarding guard. Brand-new students are routed to the
  // 3-step wizard (/student/teachers?new=1) exactly once, until
  // `profiles.onboarding_completed` is flipped to true by the
  // `completeOnboarding` server action. This check runs BEFORE the heavy
  // dashboard view so we don't pay for ~25 queries on a redirect.
  //
  // No redirect loop: the wizard lives at /student/teachers (not here),
  // and step 3 → completeOnboarding sets the flag → routes back here →
  // guard passes → dashboard renders.
  const { data: profileRow } = await supabase
    .from("profiles")
    .select("onboarding_completed")
    .eq("id", user.id)
    .maybeSingle<{ onboarding_completed: boolean }>();
  if (!profileRow?.onboarding_completed) {
    redirect("/student/teachers?new=1");
  }

  const sp = await searchParams;
  const now = new Date();
  const currentYear = now.getFullYear();
  const selectedYear = Number(sp.year) || currentYear;
  const isCurrentYear = selectedYear === currentYear;

  // When the topbar year filter selects a non-current year, scope ALL counts
  // and the "this month" widget to that year (Jan 1 → Dec 31 of selectedYear).
  const yearStart = new Date(selectedYear, 0, 1).toISOString();
  const yearEnd = new Date(selectedYear, 11, 31, 23, 59, 59, 999).toISOString();
  const monthStart = isCurrentYear
    ? new Date(currentYear, now.getMonth(), 1).toISOString()
    : yearStart;
  const monthEnd = isCurrentYear ? undefined : yearEnd;

  // All dashboard reads (the ~14 raw queries + 8 dashboard-queries helpers,
  // ~25-30 queries/render) live behind this one view module. The page is the
  // HTTP boundary: auth + onboarding guard + year-filter computation + render.
  // loadOrFail error handling moved INTO the view alongside its reads and is
  // surfaced back here as the single `anyFailed` flag (DataLoadBanner).
  //
  // `isNewStudent` (view-level short-circuit for zero-activity profiles) is
  // intentionally NOT used as a redirect trigger anymore — the authoritative
  // onboarding gate now lives at the top of this page via
  // `profiles.onboarding_completed` (issue #545). A returning student who
  // finished onboarding but has no sessions yet renders an empty dashboard,
  // which is correct. The view still short-circuits to emptyData for perf.
  const { data, anyFailed } = await studentDashboardView(supabase, user.id, {
    now,
    isCurrentYear,
    yearStart,
    yearEnd,
    monthStart,
    monthEnd,
  });

  const murajaahSlot = (
    <Suspense fallback={<StudentMurajaahSkeleton />}>
      <StudentMurajaahSection studentId={user.id} />
    </Suspense>
  );

  const analyticsSlot = (
    <Suspense fallback={<StudentAnalyticsSkeleton />}>
      <StudentAnalyticsSection
        studentId={user.id}
        weeklyMinutes={data.streakInfo.weeklyMinutes}
        weeklyDelta={data.streakInfo.weeklyDelta}
      />
    </Suspense>
  );

  return (
    <>
      <DataLoadBanner failed={anyFailed} />
      <StudentDashboardContent data={data} murajaahSlot={murajaahSlot} analyticsSlot={analyticsSlot} />
    </>
  );
}
