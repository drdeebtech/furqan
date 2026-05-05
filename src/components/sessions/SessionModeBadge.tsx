"use client";

import { Users, BookOpen, Megaphone } from "lucide-react";
import { useLang } from "@/lib/i18n/context";

/**
 * Group-structure discriminator for a session.
 *
 * Mirrors the `session_mode` Postgres enum added in Stage 1 (migration
 * 20260505204950_add_session_modes_foundation.sql). Kept as a string-literal
 * union here so the component compiles before Stage 1 lands in production —
 * any unrecognized value falls back to 'private' (the legacy default).
 *
 * NOT to be confused with `session_type` (Quranic subject — hifz / tajweed /
 * muraja / etc.), which is a different existing enum.
 */
export type SessionMode = "private" | "halaqa" | "lecture";

interface Props {
  /** session.session_mode from the DB. Optional — pre-Stage-1 rows lack the column entirely. */
  mode?: SessionMode | string | null | undefined;
  /** Visual size. Default 'md' for cards, 'sm' for table rows. */
  size?: "sm" | "md";
}

/**
 * Pill displaying the session mode with bilingual label and a small icon.
 *
 * Color treatment per `.impeccable.md` Universal Rule #5: gold #B8922D ONLY
 * on interactive elements. This badge is non-interactive, so it uses
 * neutral surface tints — a different subtle color per mode for at-a-glance
 * recognition without competing with gold CTAs nearby.
 */
export function SessionModeBadge({ mode, size = "md" }: Props) {
  const { t } = useLang();
  const resolved = normalizeMode(mode);
  const { icon: Icon, label, tone } = MODE_META[resolved](t);

  const sizing =
    size === "sm"
      ? "gap-1 px-2 py-0.5 text-[10px]"
      : "gap-1.5 px-2.5 py-1 text-xs";
  const iconSize = size === "sm" ? 10 : 12;

  return (
    <span
      className={`inline-flex items-center rounded-full border font-medium ${sizing} ${tone}`}
      data-testid="session-mode-badge"
    >
      <Icon size={iconSize} aria-hidden="true" strokeWidth={1.75} />
      {label}
    </span>
  );
}

function normalizeMode(value: Props["mode"]): SessionMode {
  if (value === "halaqa" || value === "lecture") return value;
  return "private";
}

type Meta = {
  icon: typeof Users;
  label: string;
  tone: string;
};

// Tone strategy: low-opacity tints work on both dark and light surfaces.
// The project does NOT use Tailwind's `light:`/`dark:` variants (light mode
// is signaled via `html.light` selectors in glass.css), so we ship a single
// tone per mode and let the low-opacity values blend in either context.
const MODE_META: Record<SessionMode, (t: (ar: string, en: string) => string) => Meta> = {
  private: (t) => ({
    icon: Users,
    label: t("خاص", "Private"),
    // Warm neutral — reads as "default", doesn't compete with gold CTAs.
    tone: "border-white/15 bg-white/5 text-foreground/80",
  }),
  halaqa: (t) => ({
    icon: BookOpen,
    label: t("حلقة", "Halaqa"),
    // Subtle emerald — community / circle / shared learning.
    tone: "border-emerald-400/25 bg-emerald-500/10 text-emerald-400",
  }),
  lecture: (t) => ({
    icon: Megaphone,
    label: t("مجلس", "Majlis"),
    // Subtle indigo — broadcast / one-to-many / formal.
    tone: "border-indigo-400/25 bg-indigo-500/10 text-indigo-400",
  }),
};
