import type { HTMLAttributes, ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cx } from "@/lib/cx";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("rounded-card border border-line bg-card shadow-card", className)} {...props} />;
}

/**
 * Period-over-period change.
 *
 * `null` means there is no baseline (the previous window was zero), which is
 * different from "no change" — showing 0% or an arrow there would invent a
 * trend out of nothing.
 *
 * `goodWhenDown` exists because a rising number is not always good news: for
 * SLA breaches or lost deals the colours have to invert, and a green arrow on a
 * worsening metric is worse than no arrow at all.
 */
export function Delta({
  value,
  unit = "%",
  goodWhenDown = false,
}: {
  value: number | null | undefined;
  unit?: string;
  goodWhenDown?: boolean;
}) {
  if (value === null || value === undefined) {
    return (
      <span data-testid="delta" className="text-[11.5px] text-dim">
        لا مقارنة
      </span>
    );
  }
  if (value === 0) {
    return (
      <span data-testid="delta" className="flex items-center gap-0.5 text-[11.5px] text-dim">
        <Minus size={11} /> بلا تغيّر
      </span>
    );
  }

  const up = value > 0;
  const good = goodWhenDown ? !up : up;
  const Icon = up ? ArrowUpRight : ArrowDownRight;

  return (
    <span
      data-testid="delta"
      className={`flex items-center gap-0.5 text-[11.5px] font-semibold ${good ? "text-primary" : "text-danger"}`}
      title="مقارنة بالفترة السابقة"
    >
      <Icon size={12} />
      {Math.abs(value)}
      {unit}
    </span>
  );
}

export function StatCard({
  label,
  value,
  suffix,
  tone,
  icon,
  delta,
  deltaUnit,
  goodWhenDown,
}: {
  label: string;
  value: ReactNode;
  suffix?: string;
  tone?: "primary" | "warn" | "danger";
  icon?: ReactNode;
  delta?: number | null;
  deltaUnit?: string;
  goodWhenDown?: boolean;
}) {
  const toneCls =
    tone === "primary"
      ? "text-primary"
      : tone === "warn"
        ? "text-warn"
        : tone === "danger"
          ? "text-danger"
          : "text-fg";
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs text-dim">{label}</div>
        {icon && <div className="text-dim/60">{icon}</div>}
      </div>
      <div className={`mt-1.5 text-[26px] font-bold leading-none ${toneCls}`}>
        {value}
        {suffix && <small className="ms-1 text-[13px] font-normal text-dim">{suffix}</small>}
      </div>
      {delta !== undefined && (
        <div className="mt-1.5">
          <Delta value={delta} unit={deltaUnit} goodWhenDown={goodWhenDown} />
        </div>
      )}
    </Card>
  );
}
