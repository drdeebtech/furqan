import type { ReactNode } from "react";

type Tone = "success" | "warning" | "danger" | "info" | "neutral";

interface StatusPillProps {
  tone: Tone;
  label: string;
  /**
   * Optional lucide icon (or any inline SVG). Color is inherited from the
   * pill so callers pass the icon at fixed size without forcing a color:
   *   <StatusPill tone="success" icon={<CheckCircle2 size={12} />} label="مؤكد" />
   */
  icon?: ReactNode;
  /**
   * Override the screen-reader label. Useful when `label` is a glyph or a
   * truncated form. Defaults to using `label` directly.
   */
  srLabel?: string;
  className?: string;
}

/**
 * Status indicator that always shows three signals — color, icon, text —
 * so colour-blind users can still read state without relying on the hue.
 *
 * Replaces the "coloured dot only" pattern flagged 8 times in the dashboard
 * audit (2 admin, 4 teacher, 2 student StatCard.statusBadge sites). Tone
 * maps to the project's CSS variable palette with a 12% alpha background.
 *
 * Server-renderable — no hooks, no effects. Pass any lucide-react icon as
 * `icon`; its colour is inherited from the pill via `currentColor`.
 */
const TONE_STYLES: Record<Tone, { color: string; bg: string }> = {
  success: { color: "var(--accent-green, #22C55E)", bg: "rgba(34, 197, 94, 0.12)" },
  warning: { color: "var(--warning, #E0A830)", bg: "rgba(224, 168, 48, 0.14)" },
  danger: { color: "var(--accent-red, #EF4444)", bg: "rgba(239, 68, 68, 0.12)" },
  info: { color: "var(--accent-blue, #3B82F6)", bg: "rgba(59, 130, 246, 0.12)" },
  neutral: { color: "var(--muted)", bg: "rgba(148, 148, 148, 0.10)" },
};

export function StatusPill({ tone, label, icon, srLabel, className }: StatusPillProps) {
  const style = TONE_STYLES[tone];
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${className ?? ""}`}
      style={{ color: style.color, background: style.bg }}
    >
      {icon ? (
        <span aria-hidden="true" className="inline-flex shrink-0">
          {icon}
        </span>
      ) : null}
      <span>{label}</span>
      {srLabel ? <span className="sr-only">{srLabel}</span> : null}
    </span>
  );
}
