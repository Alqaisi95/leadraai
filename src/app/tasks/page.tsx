"use client";
import { useEffect, useState } from "react";
import { CheckSquare, Circle, CheckCircle2, Plus, X } from "lucide-react";
import Shell from "@/components/Shell";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input, Select } from "@/components/ui/Input";
import { EmptyState, PageTitle, Skeleton } from "@/components/ui/Empty";
import { useToast } from "@/components/ui/Toast";
import { api } from "@/lib/client";

const PRIORITY: Record<string, { label: string; tone: "danger" | "warn" | "info" | "neutral" }> = {
  URGENT: { label: "عاجلة", tone: "danger" },
  HIGH: { label: "مرتفعة", tone: "warn" },
  MEDIUM: { label: "متوسطة", tone: "info" },
  LOW: { label: "منخفضة", tone: "neutral" },
};

export default function TasksPage() {
  const [items, setItems] = useState<any[] | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({ priority: "MEDIUM" });
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const load = () =>
    api("/api/tasks?pageSize=100")
      .then((d) => setItems(d.items))
      .catch(() => setItems([]));
  useEffect(() => {
    load();
  }, []);

  async function setStatus(id: string, status: string) {
    try {
      await api(`/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      load();
    } catch (e: any) {
      toast("error", e.message);
    }
  }

  async function create() {
    setBusy(true);
    try {
      await api("/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: form.title,
          priority: form.priority,
          dueAt: form.dueAt ? new Date(form.dueAt).toISOString() : undefined,
        }),
      });
      toast("success", "تمت إضافة المهمة");
      setOpen(false);
      setForm({ priority: "MEDIUM" });
      load();
    } catch (e: any) {
      toast("error", e.message);
    } finally {
      setBusy(false);
    }
  }

  const visible = items?.filter((t) => (showDone ? true : t.status === "OPEN")) ?? [];
  const overdue = (t: any) => t.status === "OPEN" && t.dueAt && new Date(t.dueAt) < new Date();

  return (
    <Shell>
      <PageTitle
        actions={
          <>
            <Button variant="outline" onClick={() => setShowDone((v) => !v)}>
              {showDone ? "إخفاء المنجزة" : "إظهار المنجزة"}
            </Button>
            <Button onClick={() => setOpen(true)}>
              <Plus size={14} /> مهمة
            </Button>
          </>
        }
      >
        المهام
      </PageTitle>

      {!items && <Skeleton className="h-32" />}
      {items?.length === 0 && (
        <EmptyState
          icon={<CheckSquare size={20} />}
          title="لا مهام"
          hint="أضف مهام متابعة لعملائك — الاتصال، إرسال عرض، تأكيد موعد."
          action={<Button onClick={() => setOpen(true)}>مهمة جديدة</Button>}
        />
      )}

      <div className="grid gap-2">
        {visible.map((t) => (
          <Card
            key={t.id}
            className={`flex items-center gap-3 px-4 py-3 ${overdue(t) ? "border-danger/40" : ""}`}
          >
            <button
              className="shrink-0 text-dim transition-colors hover:text-primary"
              onClick={() => setStatus(t.id, t.status === "DONE" ? "OPEN" : "DONE")}
              aria-label={t.status === "DONE" ? "إعادة فتح" : "إنجاز"}
            >
              {t.status === "DONE" ? (
                <CheckCircle2 size={18} className="text-primary" />
              ) : (
                <Circle size={18} />
              )}
            </button>
            <div className="min-w-0 flex-1">
              <div
                className={`text-[13.5px] font-semibold ${t.status === "DONE" ? "text-dim line-through" : ""}`}
              >
                {t.title}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11.5px] text-dim">
                {t.lead && <span>{t.lead.fullName ?? t.lead.igUsername}</span>}
                {t.dueAt && (
                  <span className={overdue(t) ? "font-bold text-danger" : ""}>
                    تستحق {new Date(t.dueAt).toLocaleDateString("ar-IQ")}
                  </span>
                )}
              </div>
            </div>
            <Badge tone={PRIORITY[t.priority]?.tone ?? "neutral"}>
              {PRIORITY[t.priority]?.label ?? t.priority}
            </Badge>
            {t.status === "OPEN" && (
              <button
                className="text-dim hover:text-danger"
                onClick={() => setStatus(t.id, "CANCELLED")}
                aria-label="إلغاء"
              >
                <X size={15} />
              </button>
            )}
          </Card>
        ))}
      </div>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="مهمة جديدة"
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              إلغاء
            </Button>
            <Button loading={busy} disabled={!form.title || form.title.length < 2} onClick={create}>
              إضافة
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          <Field label="عنوان المهمة">
            <Input
              value={form.title ?? ""}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="اتصال متابعة مع محمد"
              autoFocus
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="الأولوية">
              <Select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                {Object.entries(PRIORITY).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="تاريخ الاستحقاق">
              <Input
                type="date"
                value={form.dueAt ?? ""}
                onChange={(e) => setForm({ ...form, dueAt: e.target.value })}
              />
            </Field>
          </div>
        </div>
      </Dialog>
    </Shell>
  );
}
