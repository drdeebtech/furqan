import { createClient } from "@/lib/supabase/server";
import { Skeleton } from "@/components/shared/skeleton";
import { studentMurajaahWidgetData } from "@/lib/views/student-dashboard";
import { MurajaahCard } from "./murajaah-card";

export function StudentMurajaahSkeleton() {
  return (
    <div className="mt-6">
      <div className="glass-card p-5">
        <Skeleton className="mb-4 h-5 w-40" />
        <div className="space-y-3">
          <Skeleton className="h-12 w-full rounded-xl" />
          <Skeleton className="h-12 w-full rounded-xl" />
          <Skeleton className="h-12 w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}

export async function StudentMurajaahSection({ studentId }: { studentId: string }) {
  const supabase = await createClient();
  const items = await studentMurajaahWidgetData(supabase, studentId);
  // MurajaahCard returns null when items is empty, so the skeleton disappears
  // cleanly for students with no pending murajaah.
  return (
    <div className="mt-6">
      <MurajaahCard items={items} />
    </div>
  );
}
