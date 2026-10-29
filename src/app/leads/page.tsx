"use client";
import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { api } from "@/lib/client";

export default function LeadsPage() {
  const [pipeline, setPipeline] = useState<any>(null);
  const [error, setError] = useState("");

  async function load() {
    const data = await api("/api/pipelines");
    setPipeline(data.items?.[0] ?? null);
  }
  useEffect(() => { load().catch((e) => setError(e.message)); }, []);

  async function move(oppId: string, stageId: string, isLost: boolean) {
    try {
      const lostReason = isLost ? prompt("سبب الخسارة؟") : undefined;
      if (isLost && !lostReason) return;
      await api(`/api/opportunities/${oppId}/move`, { method: "POST", body: JSON.stringify({ stageId, lostReason }) });
      await load();
    } catch (e: any) { alert(e.message); }
  }

  return (
    <Shell>
      <h1 className="page-title">مسار المبيعات{pipeline ? ` — ${pipeline.name}` : ""}</h1>
      {error && <p className="error-text">{error}</p>}
      {!pipeline ? <p style={{ color: "var(--text-dim)" }}>جارٍ التحميل…</p> : (
        <div className="kanban">
          {pipeline.stages.map((stage: any, si: number) => (
            <div className="stage-col" key={stage.id}>
              <div className="stage-head">
                <span>{stage.name}</span>
                <span style={{ color: "var(--text-dim)" }}>{stage.opportunities.length}</span>
              </div>
              {stage.opportunities.map((opp: any) => (
                <div className="lead-card" key={opp.id}>
                  <div className="name">{opp.lead.fullName ?? opp.lead.igUsername ?? "عميل"}</div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span className={`score-badge score-${opp.lead.temperature}`}>{opp.lead.score}</span>
                    {opp.lead.phone && <span style={{ fontSize: 11.5, color: "var(--text-dim)", direction: "ltr" }}>{opp.lead.phone}</span>}
                  </div>
                  <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                    {si > 0 && (
                      <button className="btn sm ghost" onClick={() => move(opp.id, pipeline.stages[si - 1].id, pipeline.stages[si - 1].isLost)}>◀ سابق</button>
                    )}
                    {si < pipeline.stages.length - 1 && (
                      <button className="btn sm" onClick={() => move(opp.id, pipeline.stages[si + 1].id, pipeline.stages[si + 1].isLost)}>تالي ▶</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </Shell>
  );
}
