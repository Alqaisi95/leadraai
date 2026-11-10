"use client";
import { useEffect, useState } from "react";
import { BookOpen, Pencil, Plus, Trash2 } from "lucide-react";
import Shell from "@/components/Shell";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/Input";
import { EmptyState, PageTitle, Skeleton } from "@/components/ui/Empty";
import { useToast } from "@/components/ui/Toast";
import { api } from "@/lib/client";

const STATUS: Record<string, { label: string; tone: "primary" | "warn" | "danger" | "neutral" }> = {
  ACTIVE: { label: "مفهرس", tone: "primary" },
  PROCESSING: { label: "قيد المعالجة", tone: "warn" },
  FAILED: { label: "فشل", tone: "danger" },
  ARCHIVED: { label: "مؤرشف", tone: "neutral" },
};

export default function KnowledgePage() {
  const [items, setItems] = useState<any[] | null>(null);
  const [projects, setProjects] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({ type: "TEXT" });
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<any>(null);
  const toast = useToast();

  const load = () =>
    api("/api/knowledge-sources")
      .then((d) => setItems(d.items))
      .catch(() => setItems([]));
  useEffect(() => {
    load();
    api("/api/projects")
      .then((d) => setProjects(d.items))
      .catch(() => {});
  }, []);

  async function create() {
    setBusy(true);
    try {
      const res = await api("/api/knowledge-sources", {
        method: "POST",
        body: JSON.stringify({
          title: form.title,
          type: form.type,
          content: form.content,
          projectId: form.projectId || undefined,
        }),
      });
      toast("success", `تمت الفهرسة — ${res.chunks} مقطع`);
      setOpen(false);
      setForm({ type: "TEXT" });
      load();
    } catch (e: any) {
      toast("error", e.message);
    } finally {
      setBusy(false);
    }
  }

  async function openEdit(s: any) {
    setEdit({ ...s, content: "", loading: true });
    try {
      const d = await api(`/api/knowledge-sources/${s.id}`);
      setEdit({ ...s, content: d.content, loading: false });
    } catch (e: any) {
      toast("error", e.message);
      setEdit(null);
    }
  }

  async function saveEdit() {
    if (!edit) return;
    setBusy(true);
    try {
      const res = await api(`/api/knowledge-sources/${edit.id}`, {
        method: "PATCH",
        body: JSON.stringify({ title: edit.title, content: edit.content }),
      });
      toast("success", `أُعيدت الفهرسة — ${res.chunks} مقطع`);
      setEdit(null);
      load();
    } catch (e: any) {
      toast("error", e.message);
    } finally {
      setBusy(false);
    }
  }

  async function removeSource() {
    if (!edit) return;
    setBusy(true);
    try {
      await api(`/api/knowledge-sources/${edit.id}`, { method: "DELETE" });
      toast("success", "حُذف المصدر");
      setEdit(null);
      load();
    } catch (e: any) {
      toast("error", e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <PageTitle
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus size={14} /> مصدر معرفة
          </Button>
        }
      >
        معرفة الذكاء الاصطناعي
      </PageTitle>
      <p className="-mt-3 mb-4 text-[12.5px] text-dim">
        ما تضيفه هنا يستخدمه المساعد للإجابة على عملائك. الأسعار والتوفر تبقى من المخزون فقط — لا من هذه
        النصوص.
      </p>

      {!items && <Skeleton className="h-32" />}
      {items?.length === 0 && (
        <EmptyState
          icon={<BookOpen size={20} />}
          title="لا مصادر معرفة"
          hint="أضف دليل المشروع، الأسئلة الشائعة، أو سياسات الدفع — كل ما تريد أن يعرفه المساعد."
          action={<Button onClick={() => setOpen(true)}>إضافة أول مصدر</Button>}
        />
      )}

      <div className="grid gap-2.5">
        {items?.map((s) => (
          <Card key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
            <div>
              <div className="text-[14px] font-bold">{s.title}</div>
              <div className="mt-0.5 text-[12px] text-dim">
                {s._count.documents} مقطع · {s.type}
                {s.project?.name && ` · ${s.project.name}`}
                {` · ${new Date(s.createdAt).toLocaleDateString("ar-IQ")}`}
              </div>
            </div>
            <div className="flex items-center gap-2.5">
              <Badge tone={STATUS[s.status]?.tone ?? "neutral"}>{STATUS[s.status]?.label ?? s.status}</Badge>
              <Button size="sm" variant="outline" onClick={() => openEdit(s)}>
                <Pencil size={12} /> تعديل
              </Button>
            </div>
          </Card>
        ))}
      </div>

      <Dialog
        open={edit !== null}
        onClose={() => setEdit(null)}
        title="تعديل مصدر المعرفة"
        footer={
          <>
            <Button variant="danger" loading={busy} onClick={removeSource} className="me-auto">
              <Trash2 size={13} /> حذف
            </Button>
            <Button variant="outline" onClick={() => setEdit(null)}>
              إلغاء
            </Button>
            <Button
              loading={busy}
              disabled={edit?.loading || (edit?.content ?? "").length < 10}
              onClick={saveEdit}
            >
              حفظ وإعادة الفهرسة
            </Button>
          </>
        }
      >
        {edit?.loading ? (
          <Skeleton className="h-40" />
        ) : (
          edit && (
            <div className="grid gap-3">
              <Field label="العنوان">
                <Input
                  value={edit.title ?? ""}
                  onChange={(e) => setEdit({ ...edit, title: e.target.value })}
                />
              </Field>
              <Field label="المحتوى">
                <Textarea
                  className="min-h-48"
                  value={edit.content ?? ""}
                  onChange={(e) => setEdit({ ...edit, content: e.target.value })}
                />
              </Field>
              <p className="text-[11.5px] leading-relaxed text-dim">
                الحفظ يستبدل المقاطع القديمة بالكامل — المقاطع السابقة هي ما يقتبسه المساعد الآن، فتركها يبقي
                معلومات قديمة قيد الاستخدام.
              </p>
            </div>
          )
        )}
      </Dialog>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="مصدر معرفة جديد"
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              إلغاء
            </Button>
            <Button
              loading={busy}
              disabled={!form.title || (form.content ?? "").length < 10}
              onClick={create}
            >
              فهرسة
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          <Field label="العنوان">
            <Input
              value={form.title ?? ""}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="دليل مجمع الياسمين"
              autoFocus
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="النوع">
              <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                <option value="TEXT">نص</option>
                <option value="URL">رابط</option>
              </Select>
            </Field>
            <Field label="المشروع (اختياري)">
              <Select
                value={form.projectId ?? ""}
                onChange={(e) => setForm({ ...form, projectId: e.target.value })}
              >
                <option value="">كل المشاريع</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="المحتوى">
            <Textarea
              className="min-h-40"
              value={form.content ?? ""}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
              placeholder="مواصفات المشروع، خطط الدفع، المرافق، الأسئلة الشائعة…"
            />
          </Field>
        </div>
      </Dialog>
    </Shell>
  );
}
