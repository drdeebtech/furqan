import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Skeleton } from "@/components/shared/skeleton";
import { TeacherDashboardContent } from "./dashboard-content";
import { TeacherAtRiskStudents } from "./at-risk-students";
import { MentorshipCard, MentorshipCardSkeleton } from "./mentorship-card";
import { DataLoadBanner } from "@/components/shared/data-load-banner";
import { teacherDashboardView } from "@/lib/views/teacher-dashboard";
import { RosterErrorPulse, RosterErrorPulseSkeleton } from "./roster-error-pulse";
import { MurajaahHealthCard, MurajaahHealthCardSkeleton } from "./murajaah-health-card";
import { TalqeenInboxCard, TalqeenInboxCardSkeleton } from "./talqeen-inbox-card";
import { ParentReportDigestCard, ParentReportDigestCardSkeleton } from "./parent-report-digest-card";
import { RecitationStandardRoster, RecitationStandardRosterSkeleton } from "./recitation-standard-roster";

export const metadata: Metadata = { title: "لوحة المعلم" };

export default async function TeacherDashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data, anyFailed } = await teacherDashboardView(supabase, user.id);

  return (
    <main>
      <DataLoadBanner failed={anyFailed} />
      <TeacherDashboardContent data={data} />

      {/* The four bottom-section widgets stream in via <Suspense>.
          The page shell + TeacherDashboardContent above paint at TTFB
          ~200 ms; each widget renders its skeleton while its dedicated
          aggregation query runs, then swaps in the real content as it
          resolves. */}
      <div className="mx-auto max-w-7xl px-4 pb-2 sm:px-6">
        <Suspense fallback={<TalqeenInboxCardSkeleton />}>
          <TalqeenInboxCard teacherId={user.id} />
        </Suspense>
      </div>

      <div className="mx-auto max-w-7xl px-4 pb-2 sm:px-6">
        <Suspense fallback={<RosterErrorPulseSkeleton />}>
          <RosterErrorPulse teacherId={user.id} />
        </Suspense>
      </div>

      <div className="mx-auto max-w-7xl px-4 pb-2 sm:px-6">
        <Suspense fallback={<MurajaahHealthCardSkeleton />}>
          <MurajaahHealthCard teacherId={user.id} />
        </Suspense>
      </div>

      <div className="mx-auto max-w-7xl px-4 pb-2 sm:px-6">
        <Suspense fallback={<ParentReportDigestCardSkeleton />}>
          <ParentReportDigestCard teacherId={user.id} />
        </Suspense>
      </div>

      <div className="mx-auto max-w-7xl px-4 pb-2 sm:px-6">
        <Suspense fallback={<RecitationStandardRosterSkeleton />}>
          <RecitationStandardRoster teacherId={user.id} />
        </Suspense>
      </div>

      {data.cvStatus === "approved" && (
        <div className="mx-auto max-w-7xl px-4 pb-8 sm:px-6">
          <Suspense
            fallback={
              <div className="glass-card mt-4 rounded-xl p-4" aria-hidden="true">
                <Skeleton className="mb-3 h-4 w-48" />
                <div className="space-y-2">
                  <Skeleton className="h-12 w-full rounded-lg" />
                  <Skeleton className="h-12 w-full rounded-lg" />
                </div>
              </div>
            }
          >
            <TeacherAtRiskStudents teacherId={user.id} />
          </Suspense>
        </div>
      )}

      <Suspense fallback={<MentorshipCardSkeleton />}>
        <MentorshipCard teacherId={user.id} />
      </Suspense>
    </main>
  );
}
