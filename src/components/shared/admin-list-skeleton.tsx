import { Skeleton } from "@/components/shared/skeleton";

interface AdminListSkeletonProps {
  rows?: number;
  showStats?: boolean;
}

export function AdminListSkeleton({ rows = 6, showStats = true }: AdminListSkeletonProps) {
  return (
    <div dir="rtl" className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <div>
        <Skeleton className="h-8 w-48" />
        <Skeleton className="mt-2 h-4 w-64" />
      </div>

      {showStats && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-2xl" />
          ))}
        </div>
      )}

      <div className="glass-card p-6">
        <Skeleton className="mb-5 h-5 w-40" />
        <div className="space-y-3">
          {Array.from({ length: rows }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}
