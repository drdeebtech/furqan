import type { LucideIcon } from "lucide-react";

type Severity = "info" | "warning" | "critical" | "success";

const TONES: Record<Severity, { text: string; bg: string }> = {
  info: { text: "text-blue-400", bg: "bg-blue-500/10" },
  warning: { text: "text-amber-400", bg: "bg-amber-500/10" },
  critical: { text: "text-red-400", bg: "bg-red-500/10" },
  success: { text: "text-emerald-400", bg: "bg-emerald-500/10" },
};

export function PriorityChip({
  icon: Icon,
  label,
  severity,
  className = "",
}: {
  icon: LucideIcon;
  label: string;
  severity: Severity;
  className?: string;
}) {
  const tone = TONES[severity];
  return (
    <span className={`inline-flex items-center gap-2 ${tone.bg} ${className}`}>
      <Icon size={16} className={tone.text} aria-hidden="true" />
      <span className="text-sm">{label}</span>
    </span>
  );
}

export type { Severity as PrioritySeverity };
