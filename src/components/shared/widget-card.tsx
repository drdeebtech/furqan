"use client";

interface WidgetCardProps {
  title: string;
  subtitle?: string;
  headerAction?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function WidgetCard({ title, subtitle, headerAction, children, className }: WidgetCardProps) {
  return (
    <div
      className={`rounded-[14px] border border-[var(--surface-border)] bg-[var(--surface)] p-6 shadow-[0_1px_2px_rgba(0,0,0,0.03)] ${className ?? ""}`}
    >
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-[var(--foreground)]">{title}</h3>
          {subtitle && <p className="text-xs text-[var(--muted)]">{subtitle}</p>}
        </div>
        {headerAction}
      </div>
      <div>{children}</div>
    </div>
  );
}
