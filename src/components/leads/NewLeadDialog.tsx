"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input, Select } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { api } from "@/lib/client";

/** Walk-ins and phone enquiries — not every lead arrives through a webhook. */
export function NewLeadDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState<any>({ purpose: "BUY" });
  const [projects, setProjects] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (open) {
      setForm({ purpose: "BUY" });
      api("/api/projects")
        .then((d) => setProjects(d.items))
        .catch(() => {});
    }
  }, [open]);

  const num = (v: string) => (v === "" || v == null ? undefined : Number(v));

  async function create() {
    setBusy(true);
    try {
      await api("/api/leads", {
        method: "POST",
        body: JSON.stringify({
          fullName: form.fullName,
          phone: form.phone || undefined,
          email: form.email || undefined,
          purpose: form.purpose,
          city: form.city || undefined,
          area: form.area || undefined,
          propertyType: form.propertyType || undefined,
          budgetMin: num(form.budgetMin),
          budgetMax: num(form.budgetMax),
          interestedProjectId: form.interestedProjectId || undefined,
        }),
      });
      toast("success", "تمت إضافة العميل إلى بداية المسار");
      onClose();
      onCreated();
    } catch (e: any) {
      toast("error", e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="عميل جديد"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button
            loading={busy}
            disabled={!form.fullName || form.fullName.trim().length < 2}
            onClick={create}
          >
            إضافة
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field label="الاسم الكامل">
          <Input
            value={form.fullName ?? ""}
            onChange={(e) => setForm({ ...form, fullName: e.target.value })}
            autoFocus
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="الهاتف">
            <Input
              dir="ltr"
              className="text-left"
              value={form.phone ?? ""}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="+9647701234567"
            />
          </Field>
          <Field label="الغرض">
            <Select value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })}>
              <option value="BUY">شراء</option>
              <option value="RENT">إيجار</option>
              <option value="INVEST">استثمار</option>
              <option value="UNKNOWN">غير محدد</option>
            </Select>
          </Field>
          <Field label="المدينة">
            <Input
              value={form.city ?? ""}
              onChange={(e) => setForm({ ...form, city: e.target.value })}
              placeholder="بغداد"
            />
          </Field>
          <Field label="المنطقة">
            <Input
              value={form.area ?? ""}
              onChange={(e) => setForm({ ...form, area: e.target.value })}
              placeholder="المنصور"
            />
          </Field>
          <Field label="الميزانية من ($)">
            <Input
              inputMode="numeric"
              value={form.budgetMin ?? ""}
              onChange={(e) => setForm({ ...form, budgetMin: e.target.value })}
            />
          </Field>
          <Field label="إلى ($)">
            <Input
              inputMode="numeric"
              value={form.budgetMax ?? ""}
              onChange={(e) => setForm({ ...form, budgetMax: e.target.value })}
            />
          </Field>
        </div>
        {projects.length > 0 && (
          <Field label="المشروع المهتم به">
            <Select
              value={form.interestedProjectId ?? ""}
              onChange={(e) => setForm({ ...form, interestedProjectId: e.target.value })}
            >
              <option value="">غير محدد</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>
    </Dialog>
  );
}
