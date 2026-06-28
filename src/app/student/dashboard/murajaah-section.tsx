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
  // Guard only the async data fetch — JSX must live outside the try block to
  // satisfy react-hooks/error-boundaries.
  let items: Awaited<ReturnType<typeof studentMurajaahWidgetData>>;
  try {
    const supabase = await createClient();
    items = await studentMurajaahWidgetData(supabase, studentId);
  } catch {
    return null;
  }

  if (items.length === 0) return null;
  return (
    <div className="mt-6">
      <MurajaahCard items={items} />
    </div>
  );
}
