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
    : "rounded-[14px] border border-[var(--surface-border)] bg-[var(--surface)] p-6 shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition-shadow duration-200 hover:shadow-[0_4px_16px_rgba(0,0,0,0.06)]";

  return (
    <div className={`${base} ${className ?? ""}`}>
      <div className={`mb-5 flex items-center justify-between ${variant === "flush" ? "px-6" : ""}`}>
        <div>
          <h3 className="text-[15px] font-semibold tracking-tight text-[var(--foreground)]">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-[var(--muted)]">{subtitle}</p>}
        </div>
        {headerAction}
      </div>
      <div className={variant === "flush" ? "px-6" : ""}>{children}</div>
    </div>
  );
}
