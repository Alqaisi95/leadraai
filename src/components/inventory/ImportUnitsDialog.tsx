"use client";
import { useRef, useState } from "react";
import { Check, Download, TriangleAlert, Upload } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Select, Textarea } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { api } from "@/lib/client";

const TEMPLATE = `المشروع,رقم الوحدة,الطابق,النوع,غرف النوم,الحمامات,المساحة,السعر,الحالة
مجمع الياسمين السكني,A-401,4,شقة,2,2,120,95000,متاحة
مجمع الياسمين السكني,A-402,4,شقة,3,2,155,125000,محجوزة`;

export function ImportUnitsDialog({
  open,
  onClose,
  projects,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  projects: any[];
  onImported: () => void;
}) {
  const [csv, setCsv] = useState("");
  const [defaultProjectId, setDefaultProjectId] = useState("");
  const [updateExisting, setUpdateExisting] = useState(false);
  const [preview, setPreview] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  function reset() {
    setCsv("");
    setPreview(null);
    setUpdateExisting(false);
    onClose();
  }

  async function readFile(file: File) {
    const text = await file.text();
    setCsv(text);
    setPreview(null);
  }

  async function run(commit: boolean) {
    setBusy(true);
    try {
      const res = await api("/api/units/import", {
        method: "POST",
        body: JSON.stringify({
          csv,
          commit,
          updateExisting,
          defaultProjectId: defaultProjectId || undefined,
        }),
      });
      if (commit) {
        toast("success", `أُضيفت ${res.summary.create} وحدة وحُدّثت ${res.summary.update}`);
        reset();
        onImported();
      } else {
        setPreview(res);
      }
    } catch (e: any) {
      toast("error", e.message);
    } finally {
      setBusy(false);
    }
  }

  function downloadTemplate() {
    // BOM so Excel opens the Arabic headers correctly
    const blob = new Blob(["﻿" + TEMPLATE], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "leadra-units-template.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const errors = preview?.outcomes?.filter((o: any) => o.action === "error") ?? [];
  const canCommit =
    preview && preview.summary.error === 0 && preview.summary.create + preview.summary.update > 0;

  return (
    <Dialog
      open={open}
      onClose={reset}
      title="استيراد وحدات من ملف"
      footer={
        <>
          <Button variant="outline" onClick={reset}>
            إلغاء
          </Button>
          {!preview ? (
            <Button loading={busy} disabled={!csv.trim()} onClick={() => run(false)}>
              معاينة
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => setPreview(null)}>
                رجوع
              </Button>
              <Button loading={busy} disabled={!canCommit} onClick={() => run(true)}>
                <Check size={14} /> تنفيذ الاستيراد
              </Button>
            </>
          )}
        </>
      }
    >
      {!preview ? (
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])}
            />
            <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
              <Upload size={12} /> اختر ملف CSV
            </Button>
            <Button size="sm" variant="ghost" onClick={downloadTemplate}>
              <Download size={12} /> نزّل نموذجًا
            </Button>
          </div>

          <Field label="أو الصق محتوى الملف">
            <Textarea
              className="min-h-32 font-mono text-[11.5px]"
              dir="ltr"
              value={csv}
              onChange={(e) => {
                setCsv(e.target.value);
                setPreview(null);
              }}
              placeholder={TEMPLATE}
            />
          </Field>

          {projects.length > 0 && (
            <Field label="المشروع الافتراضي (إن لم يكن بالملف عمود مشروع)">
              <Select value={defaultProjectId} onChange={(e) => setDefaultProjectId(e.target.value)}>
                <option value="">— لا شيء —</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          <label className="flex items-center gap-2 text-[12.5px]">
            <input
              type="checkbox"
              className="size-4 accent-[var(--primary)]"
              checked={updateExisting}
              onChange={(e) => setUpdateExisting(e.target.checked)}
            />
            تحديث الوحدات الموجودة بدل تخطّيها
          </label>

          <p className="text-[11.5px] leading-relaxed text-dim">
            الأعمدة المقبولة بالعربية أو الإنجليزية. المطلوب: رقم الوحدة، والمشروع (أو اختر افتراضيًا). لا
            يُكتب أي شيء قبل مراجعتك للمعاينة.
          </p>
        </div>
      ) : (
        <div className="grid gap-3">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-field bg-primary-soft px-3 py-2">
              <div className="text-[19px] font-bold text-primary">{preview.summary.create}</div>
              <div className="text-[11.5px] text-dim">إضافة</div>
            </div>
            <div className="rounded-field bg-info-soft px-3 py-2">
              <div className="text-[19px] font-bold text-info">{preview.summary.update}</div>
              <div className="text-[11.5px] text-dim">تحديث</div>
            </div>
            <div
              className={`rounded-field px-3 py-2 ${preview.summary.error ? "bg-danger-soft" : "bg-line/40"}`}
            >
              <div className={`text-[19px] font-bold ${preview.summary.error ? "text-danger" : "text-dim"}`}>
                {preview.summary.error}
              </div>
              <div className="text-[11.5px] text-dim">أخطاء</div>
            </div>
          </div>

          {errors.length > 0 && (
            <div className="rounded-field bg-danger-soft px-3 py-2.5">
              <div className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-bold text-danger">
                <TriangleAlert size={13} /> صفوف تحتاج تصحيحًا — لن يُستورد شيء قبل إصلاحها
              </div>
              <div className="max-h-40 overflow-y-auto">
                {errors.map((e: any, i: number) => (
                  <div key={i} className="border-b border-danger/15 py-1 text-[11.5px] last:border-0">
                    <b>صف {e.row}</b>
                    {e.unitNumber && ` · ${e.unitNumber}`} — {e.reason}
                  </div>
                ))}
              </div>
            </div>
          )}

          {preview.summary.error === 0 && (
            <div className="max-h-48 overflow-y-auto rounded-field border border-line">
              <table className="w-full text-[11.5px]">
                <thead>
                  <tr className="border-b border-line bg-background/60 text-dim">
                    {["صف", "الوحدة", "المشروع", "السعر", "الحالة", "الإجراء"].map((h) => (
                      <th key={h} className="px-2.5 py-1.5 text-start font-semibold">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.outcomes.map((o: any, i: number) => (
                    <tr key={i} className="border-b border-line last:border-0">
                      <td className="px-2.5 py-1.5 text-dim">{o.row}</td>
                      <td className="px-2.5 py-1.5 font-semibold">{o.unitNumber}</td>
                      <td className="px-2.5 py-1.5 text-dim">{o.project}</td>
                      <td className="px-2.5 py-1.5">{o.price != null ? o.price.toLocaleString() : "—"}</td>
                      <td className="px-2.5 py-1.5 text-dim">{o.status}</td>
                      <td className="px-2.5 py-1.5">{o.action === "create" ? "إضافة" : "تحديث"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}
