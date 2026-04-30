import type { LucideIcon } from "lucide-react";

type Severity = "info" | "warning" | "critical" | "success";

const TONES: Record<Severity, { text: string; bg: string }> = {
  info: { text: "text-blue-400", bg: "bg-blue-500/10" },
  warning: { text: "text-warning", bg: "bg-warning/10" },
  critical: { text: "text-red-400", bg: "bg-error/10" },
  success: { text: "text-success", bg: "bg-success/10" },
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
