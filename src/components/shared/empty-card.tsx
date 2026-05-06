import Link from "next/link";

interface EmptyCardProps {
  /**
   * 'quiet' — neutral muted shell, used when a widget has no data yet
   *           and the absence is unremarkable (e.g. "no at-risk students").
   * 'celebration' — soft gold accent, used when an empty state is a *win*
   *           (e.g. "inbox zero", "all caught up").
   */
  variant: "quiet" | "celebration";
  title: string;
  body: string;
  /** Optional Next Link target. Renders a glass-gold pill CTA when paired with actionLabel. */
  actionHref?: string;
  actionLabel?: string;
  className?: string;
}

/**
 * Layout-stable empty placeholder for self-fetching widgets that previously
 * `return null` on empty data (audit flagged 5 sites: 4 teacher widgets +
 * moderator at-risk-students). Returning null collapses the grid slot,
 * making the page jump as widgets stream in. EmptyCard keeps the slot at
 * its rendered height so the visual rhythm is preserved.
 *
 * Distinct from `EmptyState` (which is the in-card empty message). EmptyCard
 * IS the card; EmptyState is the message inside one.
 *
 * Server-renderable. Uses Next `<Link>` for any CTA so navigation stays in
 * the SPA shell (no full reload).
 */
export function EmptyCard({
  variant,
  title,
  body,
  actionHref,
  actionLabel,
  className,
}: EmptyCardProps) {
  const accent =
    variant === "celebration"
      ? "ring-1 ring-inset ring-[color:var(--gold-dim,rgba(200,166,82,0.18))]"
      : "";

  return (
    <div
      className={`glass-card rounded-2xl p-6 text-center ${accent} ${className ?? ""}`}
    >
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      <p className="mt-1 text-sm text-muted">{body}</p>
      {actionHref && actionLabel ? (
        <Link
          href={actionHref}
          className="glass-gold glass-pill mt-4 inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium"
        >
          {actionLabel}
        </Link>
      ) : null}
    </div>
  );
}
