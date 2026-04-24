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
    ? "rounded-[16px] bg-[var(--surface)] py-5"
    : "glass-card p-6 transition-shadow duration-200 hover:shadow-[0_8px_24px_rgba(0,0,0,0.12)]";

  return (
    <div className={`${base} ${className ?? ""}`}>
      <div className={`mb-5 flex items-center justify-between ${variant === "flush" ? "px-6" : ""}`}>
        <div>
          <h3 className="text-base font-bold leading-snug text-foreground">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
        </div>
        {headerAction}
      </div>
      <div className={variant === "flush" ? "px-6" : ""}>{children}</div>
    </div>
  );
}
