import { Skeleton } from "@/components/shared/skeleton";

export default function StudentProgressLoading() {
  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6">
      {/* Title */}
      <div>
        <Skeleton className="h-7 w-28" />
        <Skeleton className="mt-2 h-4 w-44" />
      </div>

      {/* 4 stat cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="glass-card p-5">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="mt-3 h-8 w-12" />
          </div>
        ))}
      </div>

      {/* Evaluation chart */}
      <div className="glass-card p-6">
        <Skeleton className="mb-5 h-5 w-40" />
        <Skeleton className="h-[200px] w-full rounded-xl" />
      </div>

      {/* Follow-up breakdown */}
      <div className="glass-card p-5">
        <Skeleton className="mb-4 h-5 w-36" />
        <Skeleton className="h-6 w-full rounded-[8px]" />
      </div>

      {/* Progress records list */}
      <div className="glass-card p-6">
        <Skeleton className="mb-5 h-5 w-44" />
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-xl" />
          ))}
        </div>
      </div>
    </div>
  );
}
