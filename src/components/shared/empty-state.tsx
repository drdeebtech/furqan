interface EmptyStateProps {
  message: string;
  className?: string;
}

export function EmptyState({ message, className }: EmptyStateProps) {
  return (
    <div
      className={`rounded-2xl border border-surface-border/60 bg-surface/40 p-10 text-center text-sm text-muted ${className ?? ""}`}
    >
      {message}
    </div>
  );
}
