import { createClient } from "@/lib/supabase/server";
import { Skeleton } from "@/components/shared/skeleton";
import { studentAnalyticsWidgetData } from "@/lib/views/student-dashboard";
import { StudentAnalyticsContent } from "./analytics-content";

export function StudentAnalyticsSkeleton() {
  return (
    <>
      <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <div className="glass-card p-6">
            <Skeleton className="mb-3 h-5 w-44" />
            <Skeleton className="h-[200px] w-full rounded-xl" />
          </div>
        </div>
        <div className="space-y-6 lg:col-span-2">
          <Skeleton className="h-36 w-full rounded-2xl" />
          <Skeleton className="h-36 w-full rounded-2xl" />
          <Skeleton className="h-24 w-full rounded-2xl" />
        </div>
      </div>
      <div className="mt-10">
        <div className="glass-card p-6">
          <Skeleton className="mb-5 h-5 w-48" />
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

export async function StudentAnalyticsSection({
  studentId,
  weeklyMinutes,
  weeklyDelta,
}: {
  studentId: string;
  weeklyMinutes: number;
  weeklyDelta: number;
}) {
  const supabase = await createClient();
  const { studyAnalytics, liveSessions, hwCounts, watchingRows, continueIsLessons } =
    await studentAnalyticsWidgetData(supabase, studentId);

  return (
    <StudentAnalyticsContent
      studyAnalytics={studyAnalytics}
      liveSessions={liveSessions}
      hwCounts={hwCounts}
      watchingRows={watchingRows}
      continueIsLessons={continueIsLessons}
      weeklyMinutes={weeklyMinutes}
      weeklyDelta={weeklyDelta}
    />
  );
}
