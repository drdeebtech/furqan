import { Skeleton } from "@/components/shared/skeleton";

export default function StudentDashboardLoading() {
  return (
    <>
      <div className="h-0.5 bg-gradient-to-l from-gold/0 via-gold/30 to-gold/0" />
      <div dir="rtl" className="mx-auto max-w-4xl px-4 py-8">
        {/* Title */}
        <Skeleton className="h-8 w-44" />
        <Skeleton className="mt-2 h-4 w-52" />

        {/* Next session card */}
        <div className="mt-8 glass-card p-5 sm:p-8">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="mt-3 h-5 w-40" />
          <Skeleton className="mt-2 h-4 w-32" />
          <Skeleton className="mt-2 h-4 w-56" />
          <Skeleton className="mt-4 h-10 w-36 rounded-lg" />
        </div>

        {/* Stat cards — 4 columns */}
        <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="glass-card p-3 sm:p-4">
              <Skeleton className="h-4 w-4" />
              <Skeleton className="mt-1 h-7 w-12" />
              <Skeleton className="mt-1 h-3 w-20" />
            </div>
          ))}
        </div>

        {/* Recent sessions */}
        <div className="mt-8">
          <Skeleton className="mb-4 h-6 w-28" />
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="glass-card p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className="mt-1 h-3 w-20" />
                  </div>
                  <Skeleton className="h-3 w-16" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
