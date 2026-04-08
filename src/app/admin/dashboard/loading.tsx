import { Skeleton } from "@/components/shared/skeleton";

export default function AdminDashboardLoading() {
  return (
    <>
      <div className="h-0.5 bg-gradient-to-l from-gold/0 via-gold/30 to-gold/0" />
      <div dir="rtl" className="mx-auto max-w-5xl px-4 py-8">
        {/* Title */}
        <Skeleton className="h-8 w-40" />
        <Skeleton className="mt-2 h-4 w-28" />

        {/* Stat cards grid — 4 columns */}
        <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="glass-card p-3 sm:p-5">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="mt-2 h-7 w-16" />
            </div>
          ))}
        </div>

        {/* Today's Activity section */}
        <div className="mt-10">
          <Skeleton className="mb-4 h-6 w-32" />
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 glass-card rounded-xl p-3 sm:p-4">
                <Skeleton className="h-10 w-16 shrink-0 rounded-lg" />
                <div className="min-w-0 flex-1">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="mt-1 h-3 w-24" />
                </div>
                <Skeleton className="h-5 w-14 rounded-full" />
              </div>
            ))}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="mt-10">
          <Skeleton className="mb-4 h-6 w-28" />
          <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-11 w-32 rounded-xl" />
            ))}
          </div>
        </div>

        {/* Teacher Management table */}
        <div className="mt-10">
          <Skeleton className="mb-4 h-6 w-36" />
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="glass-card rounded-xl p-3 sm:p-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="mt-1 h-3 w-40" />
                  </div>
                  <Skeleton className="h-8 w-20 rounded-lg" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
