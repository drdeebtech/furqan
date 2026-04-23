export function riskTone(score: number | null | undefined): string {
  if (score == null) return "text-muted";
  if (score >= 75) return "text-red-400";
  if (score >= 60) return "text-orange-400";
  if (score >= 40) return "text-amber-400";
  return "text-emerald-400";
}

export function riskBadgeClass(score: number | null | undefined): string {
  if (score == null) return "border-white/10 bg-white/5 text-muted";
  if (score >= 75) return "border-red-500/30 bg-red-500/10 text-red-400";
  if (score >= 60) return "border-orange-500/30 bg-orange-500/10 text-orange-400";
  if (score >= 40) return "border-amber-500/30 bg-amber-500/10 text-amber-400";
  return "border-emerald-500/30 bg-emerald-500/10 text-emerald-400";
}

export function riskLabel(score: number | null | undefined): string {
  if (score == null) return "—";
  if (score >= 75) return "حرج";
  if (score >= 60) return "مرتفع";
  if (score >= 40) return "متوسط";
  return "منخفض";
}
