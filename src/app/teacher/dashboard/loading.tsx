import { Skeleton } from "@/components/shared/skeleton";

export default function TeacherDashboardLoading() {
  return (
    <>
      <div className="h-0.5 bg-gradient-to-l from-gold/0 via-gold/30 to-gold/0" />
      <div dir="rtl" className="mx-auto max-w-4xl px-4 py-8">
        {/* Title */}
        <Skeleton className="h-8 w-44" />
        <Skeleton className="mt-2 h-4 w-48" />

        {/* Today's sessions */}
        <div className="mt-8">
          <Skeleton className="mb-4 h-6 w-28" />
          <div className="space-y-3">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-card-border bg-card p-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="mt-1 h-3 w-40" />
                    <Skeleton className="mt-1 h-3 w-48" />
                  </div>
                  <Skeleton className="h-9 w-24 rounded-lg" />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Stat cards — 4 columns */}
        <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-card-border bg-card p-3 sm:p-4">
              <Skeleton className="h-4 w-4" />
              <Skeleton className="mt-1 h-7 w-12" />
              <Skeleton className="mt-1 h-3 w-20" />
            </div>
          ))}
        </div>

        {/* Pending bookings */}
        <div className="mt-8">
          <Skeleton className="mb-4 h-6 w-40" />
          <div className="space-y-3">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-card-border bg-card p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="mt-1 h-3 w-36" />
                    <Skeleton className="mt-1 h-3 w-44" />
                  </div>
                  <Skeleton className="h-9 w-20 rounded-lg" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
