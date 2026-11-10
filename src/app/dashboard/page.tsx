"use client";
import { useEffect, useState } from "react";
import { Bot, Handshake, Timer, Gauge } from "lucide-react";
import Shell from "@/components/Shell";
import { Card, StatCard } from "@/components/ui/Card";
import { PageTitle, Skeleton } from "@/components/ui/Empty";
import dynamic from "next/dynamic";
import { Funnel } from "@/components/charts/Funnel";
import { api } from "@/lib/client";

// recharts is the single heaviest thing on this page and nothing above the
// fold needs it. Loading it on the client only, after the shell paints, keeps
// it out of the first bundle — the skeleton is what the page shows until the
// data arrives anyway.
const TrendChart = dynamic(() => import("@/components/charts/TrendChart").then((m) => m.TrendChart), {
  ssr: false,
  loading: () => <Skeleton className="h-64" />,
});

const PERIODS = [
  { days: 7, label: "7 أيام" },
  { days: 30, label: "30 يومًا" },
  { days: 90, label: "90 يومًا" },
];

export default function DashboardPage() {
  const [days, setDays] = useState(30);
  const [overview, setOverview] = useState<any>(null);
  const [trends, setTrends] = useState<any>(null);
  const [team, setTeam] = useState<any>(null);
  const [ai, setAi] = useState<any>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setOverview(null);
    setTrends(null);
    api(`/api/reports/overview?days=${days}`)
      .then(setOverview)
      .catch((e) => setError(e.message));
    api(`/api/reports/trends?days=${days}`)
      .then(setTrends)
      .catch(() => {});
  }, [days]);

  useEffect(() => {
    api("/api/reports/team")
      .then(setTeam)
      .catch(() => {});
    api("/api/reports/ai")
      .then(setAi)
      .catch(() => {});
  }, []);

  return (
    <Shell>
      <PageTitle
        actions={
          <div className="flex gap-1.5">
            {PERIODS.map((p) => (
              <button
                key={p.days}
                className={`rounded-full px-3 py-1 text-[12px] font-semibold transition-colors ${
                  days === p.days
                    ? "bg-primary text-primary-fg"
                    : "border border-line bg-card text-dim hover:text-fg"
                }`}
                onClick={() => setDays(p.days)}
              >
                {p.label}
              </button>
            ))}
          </div>
        }
      >
        لوحة القيادة
      </PageTitle>
      {overview?.previous && (
        <p className="-mt-2 mb-4 text-[12px] text-dim">
          الأسهم تقارن بالفترة السابقة المماثلة ({days} يومًا قبلها). المؤشرات اللحظية — الجاهزون للبيع وقيمة
          الـ Pipeline والمخزون — بلا مقارنة لأنها تصف الآن لا فترة.
        </p>
      )}
      {error && <p className="mb-4 text-[13px] font-medium text-danger">{error}</p>}

      {!overview && !error && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-[86px]" />
          ))}
        </div>
      )}

      {overview && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard
              label="محادثات جديدة"
              value={overview.newConversations}
              delta={overview.deltas?.newConversations}
            />
            <StatCard label="عملاء جدد" value={overview.newLeads} delta={overview.deltas?.newLeads} />
            <StatCard
              label="معدل التأهيل"
              value={overview.conversionRate}
              suffix="%"
              delta={overview.deltas?.conversionRate}
              deltaUnit=" نقطة"
            />
            <StatCard label="جاهزون للبيع الآن" value={overview.salesReady} tone="primary" />
            <StatCard label="صفقات مغلقة" value={overview.wonDeals} delta={overview.deltas?.wonDeals} />
            <StatCard
              label="قيمة الـ Pipeline"
              value={Number(overview.pipelineValue).toLocaleString()}
              suffix="$"
            />
            <StatCard
              label="وحدات متاحة / مباعة"
              value={overview.inventory.available}
              suffix={`/ ${overview.inventory.sold}`}
            />
          </div>

          <div className="mb-4 grid gap-3 lg:grid-cols-[1.6fr_1fr]">
            <Card className="p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-[14px] font-bold">المحادثات والعملاء يوميًا</h2>
                <div className="flex items-center gap-3 text-[11.5px] text-dim">
                  <span className="flex items-center gap-1.5">
                    <span className="size-2 rounded-full bg-primary" /> محادثات
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="size-2 rounded-full bg-copper" /> عملاء
                  </span>
                </div>
              </div>
              {trends ? <TrendChart data={trends.daily} /> : <Skeleton className="h-64" />}
            </Card>
            <Card className="p-4">
              <h2 className="mb-3 text-[14px] font-bold">قمع المبيعات — الفرص بكل مرحلة</h2>
              {trends ? <Funnel stages={trends.funnel} /> : <Skeleton className="h-64" />}
            </Card>
          </div>

          {ai && (
            <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatCard
                label="معالجة AI للمحادثات"
                value={ai.aiHandledRate}
                suffix="%"
                icon={<Bot size={16} />}
              />
              <StatCard label="تسليم بشري" value={ai.handoffRate} suffix="%" icon={<Handshake size={16} />} />
              <StatCard label="متوسط الثقة" value={ai.avgConfidence ?? "—"} icon={<Gauge size={16} />} />
              <StatCard
                label="زمن استجابة AI"
                value={ai.avgLatencyMs ?? "—"}
                suffix="ms"
                icon={<Timer size={16} />}
              />
            </div>
          )}

          {overview.sources?.length > 0 && (
            <section className="mb-4">
              <h2 className="mb-2.5 text-[15px] font-bold">مصادر العملاء</h2>
              <Card className="overflow-hidden">
                <table className="w-full text-[13.5px]">
                  <thead>
                    <tr className="border-b border-line bg-background/60 text-xs text-dim">
                      <th className="px-4 py-2.5 text-start font-semibold">الحملة</th>
                      <th className="px-4 py-2.5 text-start font-semibold">عدد العملاء</th>
                      <th className="px-4 py-2.5 text-start font-semibold">تكلفة العميل</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.sources.map((s: any, i: number) => (
                      <tr key={i} className="border-b border-line last:border-0">
                        <td className="px-4 py-2.5">{s.campaign}</td>
                        <td className="px-4 py-2.5">{s.leads}</td>
                        <td className="px-4 py-2.5">{s.costPerLead ? `$${s.costPerLead}` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </section>
          )}
        </>
      )}

      {team?.rows?.length > 0 && (
        <section>
          <h2 className="mb-2.5 text-[15px] font-bold">
            أداء الفريق{" "}
            <span className="font-normal text-dim">(SLA للرد الأول: {team.slaMinutes} دقيقة)</span>
          </h2>
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-[13.5px]">
              <thead>
                <tr className="border-b border-line bg-background/60 text-xs text-dim">
                  {[
                    "الموظف",
                    "العملاء",
                    "الصفقات",
                    "المواعيد",
                    "متوسط أول رد",
                    "مخالفات SLA",
                    "عملاء دون نشاط",
                  ].map((h) => (
                    <th key={h} className="px-4 py-2.5 text-start font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {team.rows.map((r: any, i: number) => (
                  <tr key={i} className="border-b border-line last:border-0">
                    <td className="px-4 py-2.5 font-medium">{r.member}</td>
                    <td className="px-4 py-2.5">{r.leads}</td>
                    <td className="px-4 py-2.5">{r.wonDeals}</td>
                    <td className="px-4 py-2.5">{r.appointments}</td>
                    <td className="px-4 py-2.5">
                      {r.avgFirstResponseMin != null ? `${r.avgFirstResponseMin} د` : "—"}
                    </td>
                    <td className={`px-4 py-2.5 ${r.slaBreaches > 0 ? "font-bold text-danger" : ""}`}>
                      {r.slaBreaches}
                    </td>
                    <td className={`px-4 py-2.5 ${r.staleLeads > 0 ? "font-bold text-warn" : ""}`}>
                      {r.staleLeads}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </section>
      )}
    </Shell>
  );
}
