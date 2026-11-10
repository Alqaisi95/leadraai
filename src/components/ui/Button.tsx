"use client";
import type { ButtonHTMLAttributes } from "react";
import { Loader2 } from "lucide-react";
import { cx } from "@/lib/cx";

type Variant = "primary" | "outline" | "ghost" | "danger";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-primary text-primary-fg hover:bg-primary-hover shadow-sm",
  outline: "border border-line bg-card text-fg hover:border-primary hover:text-primary",
  ghost: "text-dim hover:bg-primary-soft hover:text-primary",
  danger: "bg-danger-soft text-danger hover:brightness-95",
};
const SIZES: Record<Size, string> = {
  sm: "h-7 px-2.5 text-xs rounded-md gap-1",
  md: "h-9 px-4 text-sm rounded-field gap-1.5",
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  className,
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean }) {
  return (
    <button
      className={cx(
        `inline-flex items-center justify-center font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50 disabled:pointer-events-none ${VARIANTS[variant]} ${SIZES[size]}`,
        className,
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Loader2 className="animate-spin" size={size === "sm" ? 13 : 15} />}
      {children}
    </button>
  );
}
