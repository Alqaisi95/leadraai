"use client";
import { useEffect, useMemo, useState } from "react";
import { CalendarDays, MapPin, Phone } from "lucide-react";
import Shell from "@/components/Shell";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Select } from "@/components/ui/Input";
import { EmptyState, PageTitle, Skeleton } from "@/components/ui/Empty";
import { useToast } from "@/components/ui/Toast";
import { api } from "@/lib/client";

const STATUS: Record<string, { label: string; tone: "primary" | "warn" | "danger" | "info" | "neutral" }> = {
  SCHEDULED: { label: "مجدول", tone: "info" },
  CONFIRMED: { label: "مؤكد", tone: "primary" },
  COMPLETED: { label: "تمت الزيارة", tone: "primary" },
  NO_SHOW: { label: "لم يحضر", tone: "danger" },
  CANCELLED: { label: "ملغي", tone: "neutral" },
};

const DAY_MS = 86400_000;

export default function AppointmentsPage() {
  const [items, setItems] = useState<any[] | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);
  const toast = useToast();

  const { from, to, days } = useMemo(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay() + weekOffset * 7);
    const end = new Date(start.getTime() + 7 * DAY_MS);
    return {
      from: start,
      to: end,
      days: Array.from({ length: 7 }, (_, i) => new Date(start.getTime() + i * DAY_MS)),
    };
  }, [weekOffset]);

  function load() {
    setItems(null);
    api(`/api/appointments?from=${from.toISOString()}&to=${to.toISOString()}`)
      .then((d) => setItems(d.items))
      .catch(() => setItems([]));
  }
  useEffect(load, [weekOffset]);

  async function setStatus(id: string, status: string) {
    try {
      await api(`/api/appointments/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      toast("success", "تم تحديث حالة الموعد");
      load();
    } catch (e: any) {
      toast("error", e.message);
    }
  }

  const byDay = (d: Date) =>
    items?.filter((a) => new Date(a.startsAt).toDateString() === d.toDateString()) ?? [];

  return (
    <Shell>
      <PageTitle
        actions={
          <div className="flex items-center gap-2 text-[12.5px]">
            <button
              className="rounded-field border border-line bg-card px-2.5 py-1 font-semibold hover:border-primary"
              onClick={() => setWeekOffset((w) => w - 1)}
            >
              ‹ السابق
            </button>
            <button
              className="rounded-field border border-line bg-card px-2.5 py-1 font-semibold hover:border-primary"
              onClick={() => setWeekOffset(0)}
            >
              هذا الأسبوع
            </button>
            <button
              className="rounded-field border border-line bg-card px-2.5 py-1 font-semibold hover:border-primary"
              onClick={() => setWeekOffset((w) => w + 1)}
            >
              التالي ›
            </button>
          </div>
        }
      >
        المواعيد
      </PageTitle>

      {!items && <Skeleton className="h-64" />}

      {items && (
        <>
          <div className="grid gap-2.5 lg:grid-cols-7">
            {days.map((d) => {
              const list = byDay(d);
              const isToday = d.toDateString() === new Date().toDateString();
              return (
                <div
                  key={d.toISOString()}
                  className={`rounded-card p-2.5 ${isToday ? "bg-primary-soft" : "bg-line/30"}`}
                >
                  <div className="mb-2 px-1 text-[12px] font-bold">
                    {d.toLocaleDateString("ar-IQ", { weekday: "long" })}
                    <span className="ms-1.5 font-normal text-dim">
                      {d.getDate()}/{d.getMonth() + 1}
                    </span>
                  </div>
                  {list.length === 0 && <div className="px-1 pb-1 text-[11px] text-dim">—</div>}
                  {list.map((a) => (
                    <Card key={a.id} className="mb-2 p-2.5">
                      <div className="text-[12px] font-bold">
                        {new Date(a.startsAt).toLocaleTimeString("ar-IQ", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                      <div className="mt-0.5 truncate text-[12.5px] font-semibold">
                        {a.lead?.fullName ?? a.lead?.igUsername ?? "عميل"}
                      </div>
                      {a.lead?.phone && (
                        <div className="mt-0.5 flex items-center gap-1 text-[10.5px] text-dim" dir="ltr">
                          <Phone size={9} />
                          {a.lead.phone}
                        </div>
                      )}
                      {a.project?.name && (
                        <div className="mt-0.5 flex items-center gap-1 truncate text-[10.5px] text-dim">
                          <MapPin size={9} />
                          {a.project.name}
                        </div>
                      )}
                      <Select
                        className="mt-2 h-6.5 text-[11px]"
                        value={a.status}
                        onChange={(e) => setStatus(a.id, e.target.value)}
                      >
                        {Object.entries(STATUS).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v.label}
                          </option>
                        ))}
                      </Select>
                    </Card>
                  ))}
                </div>
              );
            })}
          </div>

          {items.length === 0 && (
            <div className="mt-4">
              <EmptyState
                icon={<CalendarDays size={20} />}
                title="لا مواعيد هذا الأسبوع"
                hint="تُنشأ المواعيد من محادثة العميل عندما يطلب زيارة الموقع."
              />
            </div>
          )}

          {items.length > 0 && (
            <div className="mt-5">
              <h2 className="mb-2.5 text-[15px] font-bold">قائمة الأسبوع</h2>
              <Card className="overflow-x-auto">
                <table className="w-full min-w-[600px] text-[13px]">
                  <thead>
                    <tr className="border-b border-line bg-background/60 text-xs text-dim">
                      {["الموعد", "العميل", "المشروع", "الموظف", "الحالة"].map((h) => (
                        <th key={h} className="px-4 py-2.5 text-start font-semibold">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((a) => (
                      <tr key={a.id} className="border-b border-line last:border-0">
                        <td className="px-4 py-2.5">
                          {new Date(a.startsAt).toLocaleString("ar-IQ", {
                            dateStyle: "short",
                            timeStyle: "short",
                          })}
                        </td>
                        <td className="px-4 py-2.5 font-medium">
                          {a.lead?.fullName ?? a.lead?.igUsername ?? "—"}
                        </td>
                        <td className="px-4 py-2.5 text-dim">{a.project?.name ?? "—"}</td>
                        <td className="px-4 py-2.5 text-dim">{a.member?.user?.fullName ?? "—"}</td>
                        <td className="px-4 py-2.5">
                          <Badge tone={STATUS[a.status]?.tone ?? "neutral"}>
                            {STATUS[a.status]?.label ?? a.status}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </div>
          )}
        </>
      )}
    </Shell>
  );
}
