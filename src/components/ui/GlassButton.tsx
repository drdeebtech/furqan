import { type ButtonHTMLAttributes, forwardRef, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export type GlassVariant = "default" | "gold" | "danger" | "success" | "ghost";
export type GlassSize = "xs" | "sm" | "md" | "lg" | "xl" | "icon";

interface GlassButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: GlassVariant;
  size?: GlassSize;
  pill?: boolean;
  loading?: boolean;
  icon?: ReactNode;
}

const variantMap: Record<GlassVariant, string> = {
  default: "glass text-white/80 hover:text-white",
  gold: "glass-gold font-semibold tracking-wide",
  danger: "glass-danger font-medium",
  success: "glass-success font-medium",
  ghost: [
    "bg-transparent border border-white/10 hover:border-white/22",
    "text-white/50 hover:text-white/80 backdrop-blur-sm",
    "transition-all duration-200 hover:bg-white/5",
    "shadow-none hover:shadow-[0_2px_12px_rgba(0,0,0,0.25)]",
  ].join(" "),
};

const sizeMap: Record<GlassSize, string> = {
  xs: "px-3 py-1.5 text-xs gap-1.5 rounded-[10px]",
  sm: "px-4 py-2 text-sm gap-2 rounded-[12px]",
  md: "px-5 py-2.5 text-sm gap-2 rounded-[14px]",
  lg: "px-6 py-3 text-base gap-2.5 rounded-[16px]",
  xl: "px-8 py-4 text-lg gap-3 rounded-[18px]",
  icon: "p-2.5 text-sm rounded-[12px]",
};

export const GlassButton = forwardRef<HTMLButtonElement, GlassButtonProps>(
  (
    {
      variant = "default",
      size = "md",
      pill,
      loading,
      icon,
      className,
      children,
      disabled,
      ...props
    },
    ref,
  ) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        "relative overflow-hidden inline-flex items-center justify-center font-medium select-none",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C8A652]/40 focus-visible:ring-offset-1 focus-visible:ring-offset-transparent",
        "disabled:opacity-40 disabled:cursor-not-allowed disabled:!transform-none disabled:!shadow-none",
        variantMap[variant],
        sizeMap[size],
        pill && "!rounded-full",
        className,
      )}
      {...props}
    >
      {loading ? (
        <span className="w-4 h-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
      ) : (
        <>
          {icon && <span className="shrink-0">{icon}</span>}
          {children}
        </>
      )}
    </button>
  ),
);
GlassButton.displayName = "GlassButton";
