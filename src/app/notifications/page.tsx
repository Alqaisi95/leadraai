"use client";
import { useEffect, useState } from "react";
import { BellOff } from "lucide-react";
import Shell from "@/components/Shell";
import { Card } from "@/components/ui/Card";
import { EmptyState, PageTitle } from "@/components/ui/Empty";
import { api } from "@/lib/client";

export default function NotificationsPage() {
  const [items, setItems] = useState<any[] | null>(null);

  useEffect(() => {
    api("/api/notifications")
      .then((d) => {
        setItems(d.items);
        if (d.unread > 0) api("/api/notifications", { method: "POST" }).catch(() => {});
      })
      .catch(() => setItems([]));
  }, []);

  return (
    <Shell>
      <PageTitle>الإشعارات</PageTitle>
      {items?.length === 0 && (
        <EmptyState
          icon={<BellOff size={20} />}
          title="لا إشعارات"
          hint="ستصلك هنا تنبيهات التسليم البشري والمواعيد وSLA."
        />
      )}
      <div className="grid gap-2">
        {items?.map((n) => (
          <Card
            key={n.id}
            className={`border-s-4 px-4 py-3 ${n.readAt ? "border-s-line opacity-75" : "border-s-primary"}`}
          >
            <div className="flex items-start justify-between gap-3">
              <b className="text-[13.5px]">{n.title}</b>
              <span className="shrink-0 text-[11.5px] text-dim">
                {new Date(n.createdAt).toLocaleString("ar-IQ")}
              </span>
            </div>
            {n.body && <p className="mt-1 text-[12.5px] leading-relaxed text-dim">{n.body}</p>}
          </Card>
        ))}
      </div>
    </Shell>
  );
}
