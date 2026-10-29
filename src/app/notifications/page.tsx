"use client";
import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { api } from "@/lib/client";

export default function NotificationsPage() {
  const [items, setItems] = useState<any[]>([]);

  useEffect(() => {
    api("/api/notifications").then((d) => {
      setItems(d.items);
      if (d.unread > 0) api("/api/notifications", { method: "POST" }).catch(() => {});
    }).catch(() => {});
  }, []);

  return (
    <Shell>
      <h1 className="page-title">الإشعارات</h1>
      {items.length === 0 && <p style={{ color: "var(--text-dim)" }}>لا إشعارات</p>}
      <div style={{ display: "grid", gap: 8 }}>
        {items.map((n) => (
          <div className="card" key={n.id} style={{ opacity: n.readAt ? 0.7 : 1, borderRightWidth: n.readAt ? 1 : 4, borderRightColor: n.readAt ? "var(--line)" : "var(--accent)" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <b style={{ fontSize: 14 }}>{n.title}</b>
              <span style={{ fontSize: 11.5, color: "var(--text-dim)" }}>{new Date(n.createdAt).toLocaleString("ar-IQ")}</span>
            </div>
            {n.body && <p style={{ fontSize: 13, color: "var(--text-dim)", marginTop: 4 }}>{n.body}</p>}
          </div>
        ))}
      </div>
    </Shell>
  );
}
