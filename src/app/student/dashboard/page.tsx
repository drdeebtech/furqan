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
  // HTTP boundary: auth + year-filter computation + the redirect decisions +
  // render. loadOrFail error handling moved INTO the view alongside its reads
  // and is surfaced back here as the single `anyFailed` flag (DataLoadBanner).
  const { data, anyFailed, isNewStudent } = await studentDashboardView(supabase, user.id, {
    now,
    isCurrentYear,
    yearStart,
    yearEnd,
    monthStart,
    monthEnd,
  });

  // New students with no activity → guide them to teachers page.
  if (isNewStudent) {
    redirect("/student/teachers?new=1");
  }

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
