import { Skeleton } from "@/components/shared/skeleton";
import { DashboardShell } from "@/components/shared/dashboard-shell";

export default function AdminDashboardLoading() {
  return (
    <>
      <div className="h-0.5 bg-gradient-to-l from-gold/0 via-gold/30 to-gold/0" />
      <DashboardShell className="space-y-6">
        {/* Title */}
        <div>
          <Skeleton className="h-8 w-40" />
          <Skeleton className="mt-2 h-4 w-28" />
        </div>

        {/* Alert cards */}
        <div className="grid gap-3 sm:grid-cols-2">
          <Skeleton className="h-20 w-full rounded-2xl" />
          <Skeleton className="h-20 w-full rounded-2xl" />
        </div>

        {/* 4 stat cards */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="glass-card flex min-h-[168px] flex-col justify-between p-5"
            >
              <div>
                <div className="flex items-center gap-2.5">
                  <Skeleton className="h-9 w-9 rounded-[10px]" />
                  <Skeleton className="h-4 w-20" />
                </div>
                <Skeleton className="mt-4 h-10 w-16" />
              </div>
              <div className="flex items-center justify-between border-t border-[var(--surface-border)] pt-3">
                <Skeleton className="h-3 w-14" />
                <Skeleton className="h-4 w-4" />
              </div>
            </div>
          ))}
        </div>

        {/* Chart + right widgets */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <div className="glass-card p-6">
              <div className="mb-5 flex items-center justify-between">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-9 w-48 rounded-[10px]" />
              </div>
              <Skeleton className="h-[280px] w-full rounded-lg" />
            </div>
          </div>
          <div className="space-y-4 lg:col-span-2">
            <div className="glass-card p-6">
              <Skeleton className="mb-5 h-5 w-32" />
              <div className="space-y-4">
                {Array.from({ length: 2 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <Skeleton className="h-9 w-9 rounded-full" />
                    <div className="flex-1">
                      <Skeleton className="h-4 w-28" />
                      <Skeleton className="mt-1 h-3 w-20" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="glass-card p-6">
              <Skeleton className="mb-4 h-5 w-36" />
              <Skeleton className="h-7 w-full rounded-[8px]" />
              <div className="mt-4 flex gap-4">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-3 w-16" />
              </div>
            </div>
          </div>
        </div>

        {/* Data table */}
        <div className="glass-card p-6">
          <Skeleton className="mb-5 h-5 w-36" />
          <Skeleton className="h-4 w-full" />
          <div className="mt-3 space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        </div>

        {/* Today's activity + quick actions */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <div className="glass-card p-6">
              <Skeleton className="mb-5 h-5 w-32" />
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full rounded-xl" />
                ))}
              </div>
            </div>
          </div>
          <div className="lg:col-span-2">
            <div className="glass-card p-6">
              <Skeleton className="mb-4 h-5 w-32" />
              <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            </div>
          </div>
        </div>

        {/* Teacher management */}
        <div className="glass-card p-6">
          <Skeleton className="mb-5 h-5 w-40" />
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        </div>
      </DashboardShell>
    </>
  );
}
