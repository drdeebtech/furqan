export function TeacherCardSkeleton() {
  return (
    <div className="glass-card animate-pulse p-6">
      <div className="h-20 w-20 rounded-full bg-white/10" />
      <div className="mt-4 h-5 w-2/3 rounded bg-white/10" />
      <div className="mt-2 h-3 w-full rounded bg-white/10" />
      <div className="mt-1 h-3 w-4/5 rounded bg-white/10" />
      <div className="mt-3 flex gap-1.5">
        <div className="h-5 w-14 rounded-full bg-white/10" />
        <div className="h-5 w-16 rounded-full bg-white/10" />
      </div>
      <div className="mt-4 h-8 w-full rounded-lg bg-white/10" />
    </div>
  );
}

export function TeacherGridSkeleton() {
  return (
    <div
      className="grid gap-6 md:grid-cols-2 lg:grid-cols-3"
      aria-busy="true"
      aria-label="Loading teachers…"
    >
      {Array.from({ length: 12 }).map((_, i) => (
        <TeacherCardSkeleton key={i} />
      ))}
    </div>
  );
}
