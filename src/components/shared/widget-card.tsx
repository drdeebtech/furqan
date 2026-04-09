"use client";

interface WidgetCardProps {
  title: string;
  subtitle?: string;
  headerAction?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  variant?: "default" | "flush";
}

export function WidgetCard({ title, subtitle, headerAction, children, className, variant = "default" }: WidgetCardProps) {
  const base = variant === "flush"
    ? "rounded-[14px] bg-[var(--surface)] py-5"
    : "rounded-[16px] border border-[rgba(0,0,0,0.06)] bg-gradient-to-b from-white to-[#FAFAF9] p-6 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_12px_rgba(0,0,0,0.05),0_12px_32px_rgba(0,0,0,0.03),inset_0_1px_0_rgba(255,255,255,0.8)] transition-shadow duration-200 hover:shadow-[0_4px_8px_rgba(0,0,0,0.06),0_12px_28px_rgba(0,0,0,0.08),0_20px_48px_rgba(0,0,0,0.04),inset_0_1px_0_rgba(255,255,255,0.8)]";

  return (
    <div className={`${base} ${className ?? ""}`}>
      <div className={`mb-5 flex items-center justify-between ${variant === "flush" ? "px-6" : ""}`}>
        <div>
          <h3 className="text-[15px] font-bold tracking-tight text-[var(--foreground)]">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-[var(--muted)]">{subtitle}</p>}
        </div>
        {headerAction}
      </div>
      <div className={variant === "flush" ? "px-6" : ""}>{children}</div>
    </div>
  );
}
