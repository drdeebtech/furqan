import { Skeleton } from "@/components/shared/skeleton";

export default function ModeratorDashboardLoading() {
  return (
    <div dir="rtl" className="mx-auto max-w-5xl px-4 py-6 sm:py-8">
      {/* Title */}
      <Skeleton className="mb-6 h-8 w-36" />

      {/* Stat cards grid — 3 columns on lg, 2 on mobile */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="glass-card p-4 sm:p-6">
            <div className="flex items-center gap-3">
              <Skeleton className="h-5 w-5 shrink-0 rounded-md" />
              <div className="min-w-0">
                <Skeleton className="h-7 w-12" />
                <Skeleton className="mt-1 h-3 w-20" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
