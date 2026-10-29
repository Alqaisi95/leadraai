"use client";
import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { api } from "@/lib/client";

export default function DashboardPage() {
  const [overview, setOverview] = useState<any>(null);
  const [team, setTeam] = useState<any>(null);
  const [ai, setAi] = useState<any>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api("/api/reports/overview").then(setOverview).catch((e) => setError(e.message));
    api("/api/reports/team").then(setTeam).catch(() => {});
    api("/api/reports/ai").then(setAi).catch(() => {});
  }, []);

  return (
    <Shell>
      <h1 className="page-title">لوحة القيادة — آخر 30 يوماً</h1>
      {error && <p className="error-text">{error}</p>}
      {overview && (
        <>
          <div className="cards">
            <div className="card"><div className="kpi-label">محادثات جديدة</div><div className="kpi-value">{overview.newConversations}</div></div>
            <div className="card"><div className="kpi-label">عملاء جدد</div><div className="kpi-value">{overview.newLeads}</div></div>
            <div className="card"><div className="kpi-label">معدل التأهيل</div><div className="kpi-value">{overview.conversionRate}<small>%</small></div></div>
            <div className="card"><div className="kpi-label">جاهزون للبيع الآن</div><div className="kpi-value" style={{ color: "var(--accent)" }}>{overview.salesReady}</div></div>
            <div className="card"><div className="kpi-label">صفقات مغلقة</div><div className="kpi-value">{overview.wonDeals}</div></div>
            <div className="card"><div className="kpi-label">قيمة الـ Pipeline</div><div className="kpi-value">{Number(overview.pipelineValue).toLocaleString()}<small> $</small></div></div>
            <div className="card"><div className="kpi-label">وحدات متاحة / مباعة</div><div className="kpi-value">{overview.inventory.available}<small> / {overview.inventory.sold}</small></div></div>
          </div>

          {ai && (
            <div className="cards">
              <div className="card"><div className="kpi-label">معالجة AI للمحادثات</div><div className="kpi-value">{ai.aiHandledRate}<small>%</small></div></div>
              <div className="card"><div className="kpi-label">تسليم بشري</div><div className="kpi-value">{ai.handoffRate}<small>%</small></div></div>
              <div className="card"><div className="kpi-label">متوسط الثقة</div><div className="kpi-value">{ai.avgConfidence ?? "—"}</div></div>
              <div className="card"><div className="kpi-label">زمن استجابة AI</div><div className="kpi-value">{ai.avgLatencyMs ?? "—"}<small> ms</small></div></div>
            </div>
          )}

          {overview.sources?.length > 0 && (
            <div style={{ marginBottom: 22 }}>
              <h2 style={{ fontSize: 15, marginBottom: 10 }}>مصادر العملاء</h2>
              <table className="report">
                <thead><tr><th>الحملة</th><th>عدد العملاء</th><th>تكلفة العميل</th></tr></thead>
                <tbody>
                  {overview.sources.map((s: any, i: number) => (
                    <tr key={i}><td>{s.campaign}</td><td>{s.leads}</td><td>{s.costPerLead ? `$${s.costPerLead}` : "—"}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {team?.rows?.length > 0 && (
        <div>
          <h2 style={{ fontSize: 15, marginBottom: 10 }}>أداء الفريق (SLA للرد الأول: {team.slaMinutes} دقيقة)</h2>
          <table className="report">
            <thead><tr><th>الموظف</th><th>العملاء</th><th>الصفقات</th><th>المواعيد</th><th>متوسط أول رد</th><th>مخالفات SLA</th><th>عملاء دون نشاط</th></tr></thead>
            <tbody>
              {team.rows.map((r: any, i: number) => (
                <tr key={i}>
                  <td>{r.member}</td><td>{r.leads}</td><td>{r.wonDeals}</td><td>{r.appointments}</td>
                  <td>{r.avgFirstResponseMin != null ? `${r.avgFirstResponseMin} د` : "—"}</td>
                  <td style={{ color: r.slaBreaches > 0 ? "var(--hot)" : "inherit" }}>{r.slaBreaches}</td>
                  <td style={{ color: r.staleLeads > 0 ? "var(--warm)" : "inherit" }}>{r.staleLeads}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  );
}
