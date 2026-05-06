import type { ReactNode } from "react";

interface EmptyStateProps {
  /** Primary message. Required. */
  message: string;
  /** Optional secondary line — typically a hint about what to do next. */
  hint?: string;
  /**
   * Optional leading icon — typically a lucide-react `<Icon size={32}>` with `text-muted`.
   * If omitted, the empty state renders without an icon (matches the legacy minimal shape).
   */
  icon?: ReactNode;
  /** Optional CTA — usually a `<Link>` styled as `glass-gold glass-pill`. Renders below the message. */
  action?: ReactNode;
  /**
   * Visual variant. Default 'subtle' preserves the pre-extension shape
   * (bordered box on surface tint) — every caller that existed before
   * extension keeps its visual untouched. New dashboard call sites adopting
   * this primitive should pass `variant="glass-card"` to match the
   * most-common inline pattern (glass-card + p-12 + center + Inbox icon).
   */
  variant?: "glass-card" | "subtle";
  className?: string;
}

export function EmptyState({
  message,
  hint,
  icon,
  action,
  variant = "subtle",
  className,
}: EmptyStateProps) {
  const baseClass =
    variant === "glass-card"
      ? "glass-card rounded-xl p-12 text-center"
      : "rounded-2xl border border-surface-border/60 bg-surface/40 p-10 text-center text-sm text-muted";

  return (
    <div className={`${baseClass} ${className ?? ""}`}>
      {icon ? <div className="mx-auto mb-3 inline-flex">{icon}</div> : null}
      <p className={variant === "glass-card" ? "text-muted" : ""}>{message}</p>
      {hint ? <p className="mt-1 text-sm text-muted">{hint}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
