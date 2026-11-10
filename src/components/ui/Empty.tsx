import type { ReactNode } from "react";
import { Inbox } from "lucide-react";

export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon?: ReactNode;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="grid place-items-center gap-2 rounded-card border border-dashed border-line bg-card/50 px-6 py-12 text-center">
      <div className="grid size-11 place-items-center rounded-full bg-primary-soft text-primary">
        {icon ?? <Inbox size={20} />}
      </div>
      <div className="text-sm font-bold">{title}</div>
      {hint && <p className="max-w-sm text-[12.5px] leading-relaxed text-dim">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-line/60 ${className}`} />;
}

export function PageTitle({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-[21px] font-bold tracking-tight">{children}</h1>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
