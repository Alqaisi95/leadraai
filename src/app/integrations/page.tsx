"use client";
import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { api } from "@/lib/client";

const STATUS_AR: Record<string, [string, string]> = {
  CONNECTED: ["متصل", "#0F766E"], TOKEN_EXPIRED: ["الرمز منتهٍ — أعد الربط", "#B45309"],
  DISCONNECTED: ["غير متصل", "#6E7681"], ERROR: ["خطأ", "#DC2626"],
};

export default function IntegrationsPage() {
  const [items, setItems] = useState<any[]>([]);
  const [error, setError] = useState("");

  const load = () => api("/api/integrations").then((d) => setItems(d.items)).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  async function connect() {
    try {
      const { url } = await api("/api/integrations/meta/connect");
      window.location.href = url;
    } catch (e: any) { setError(e.message); }
  }

  async function disconnect(integrationId: string) {
    if (!confirm("فصل الحساب وحذف الرمز نهائياً؟")) return;
    await api("/api/integrations", { method: "DELETE", body: JSON.stringify({ integrationId }) });
    load();
  }

  return (
    <Shell>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h1 className="page-title" style={{ margin: 0 }}>مركز التكاملات</h1>
        <button className="btn" onClick={connect}>+ ربط حساب Instagram</button>
      </div>
      {error && <p className="error-text">{error}</p>}
      {items.length === 0 && <div className="card" style={{ color: "var(--text-dim)" }}>لا تكاملات بعد. اربط حساب Instagram المهني للبدء باستقبال الرسائل. (يتطلب Meta App مُراجَعاً)</div>}
      <div style={{ display: "grid", gap: 10 }}>
        {items.map((i) => {
          const [label, color] = STATUS_AR[i.status] ?? [i.status, "#6E7681"];
          return (
            <div className="card" key={i.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: 700 }}>{i.displayName ?? i.provider} <span style={{ fontSize: 12, color: "var(--text-dim)" }}>({i.provider})</span></div>
                <div style={{ fontSize: 12.5, color: "var(--text-dim)", marginTop: 4 }}>
                  {i.conversations} محادثة · آخر مزامنة: {i.lastSyncAt ? new Date(i.lastSyncAt).toLocaleString("ar-IQ") : "—"}
                  {i.tokenExpiresAt && ` · الرمز ينتهي: ${new Date(i.tokenExpiresAt).toLocaleDateString("ar-IQ")}`}
                  {i.errorCount > 0 && ` · أخطاء: ${i.errorCount}`}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 12, fontWeight: 700, color }}>{label}</span>
                {i.status !== "DISCONNECTED" && <button className="btn ghost sm" onClick={() => disconnect(i.id)}>فصل</button>}
                {i.status === "TOKEN_EXPIRED" && <button className="btn sm" onClick={connect}>إعادة ربط</button>}
              </div>
            </div>
          );
        })}
      </div>
    </Shell>
  );
}
