"use client";

/**
 * Stage bars for the pipeline funnel — plain divs, no charting library.
 * Kept in its own module so importing it does not pull recharts along.
 */
export function Funnel({
  stages,
}: {
  stages: { stage: string; count: number; isWon: boolean; isLost: boolean }[];
}) {
  const max = Math.max(1, ...stages.map((s) => s.count));
  return (
    <div className="grid gap-2">
      {stages.map((s) => (
        <div key={s.stage} className="grid grid-cols-[110px_1fr_28px] items-center gap-2 text-[12.5px]">
          <span className="truncate text-dim">{s.stage}</span>
          <div className="h-5 overflow-hidden rounded-md bg-line/40">
            <div
              className={`h-full rounded-md transition-all ${s.isWon ? "bg-primary" : s.isLost ? "bg-danger/50" : "bg-primary/55"}`}
              style={{ width: `${Math.max(s.count > 0 ? 6 : 0, (s.count / max) * 100)}%` }}
            />
          </div>
          <span className="text-end font-bold">{s.count}</span>
        </div>
      ))}
    </div>
  );
}
