"use client";
import { useEffect, useState } from "react";
import { Building2, Pencil, Plus, Trash2, Upload } from "lucide-react";
import Shell from "@/components/Shell";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input, Select } from "@/components/ui/Input";
import { EmptyState, PageTitle, Skeleton } from "@/components/ui/Empty";
import { useToast } from "@/components/ui/Toast";
import { ImportUnitsDialog } from "@/components/inventory/ImportUnitsDialog";
import { api } from "@/lib/client";

const UNIT_STATUS: Record<
  string,
  { label: string; tone: "primary" | "warn" | "danger" | "info" | "neutral" }
> = {
  AVAILABLE: { label: "متاحة", tone: "primary" },
  TEMP_RESERVED: { label: "محجوزة مؤقتًا", tone: "warn" },
  RESERVED: { label: "محجوزة", tone: "warn" },
  SOLD: { label: "مباعة", tone: "danger" },
  ON_HOLD: { label: "معلّقة", tone: "info" },
  UNAVAILABLE: { label: "غير متاحة", tone: "neutral" },
};

export default function InventoryPage() {
  const [projects, setProjects] = useState<any[] | null>(null);
  const [projectId, setProjectId] = useState("");
  const [units, setUnits] = useState<any[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [newProject, setNewProject] = useState(false);
  const [newUnit, setNewUnit] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editUnit, setEditUnit] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<any>({});
  const toast = useToast();

  const loadProjects = () =>
    api("/api/projects")
      .then((d) => setProjects(d.items))
      .catch(() => setProjects([]));
  const loadUnits = () =>
    api(`/api/units${projectId ? `?projectId=${projectId}` : ""}`)
      .then((d) => {
        setUnits(d.items);
        setCounts(d.counts ?? {});
      })
      .catch(() => setUnits([]));

  useEffect(() => {
    loadProjects();
  }, []);
  useEffect(() => {
    setUnits(null);
    loadUnits();
  }, [projectId]);

  async function setStatus(unitId: string, status: string) {
    try {
      await api(`/api/units/${unitId}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
      toast("success", "تم تحديث حالة الوحدة");
      loadUnits();
    } catch (e: any) {
      toast("error", e.message);
    }
  }

  async function saveUnit() {
    if (!editUnit) return;
    setBusy(true);
    const num = (v: any) => (v === "" || v == null ? null : Number(v));
    try {
      await api(`/api/units/${editUnit.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          unitNumber: editUnit.unitNumber,
          unitType: editUnit.unitType || null,
          floor: num(editUnit.floor),
          bedrooms: num(editUnit.bedrooms),
          bathrooms: num(editUnit.bathrooms),
          areaSqm: num(editUnit.areaSqm),
          price: num(editUnit.price),
        }),
      });
      toast("success", "حُفظت الوحدة");
      setEditUnit(null);
      loadUnits();
    } catch (e: any) {
      toast("error", e.message);
    } finally {
      setBusy(false);
    }
  }

  async function removeUnit() {
    if (!editUnit) return;
    setBusy(true);
    try {
      await api(`/api/units/${editUnit.id}`, { method: "DELETE" });
      toast("success", "حُذفت الوحدة");
      setEditUnit(null);
      loadUnits();
    } catch (e: any) {
      toast("error", e.message);
    } finally {
      setBusy(false);
    }
  }

  async function createProject() {
    setBusy(true);
    try {
      await api("/api/projects", {
        method: "POST",
        body: JSON.stringify({
          name: form.name,
          location: form.location || undefined,
          developer: form.developer || undefined,
          projectType: form.projectType || undefined,
        }),
      });
      toast("success", "تم إنشاء المشروع");
      setNewProject(false);
      setForm({});
      loadProjects();
    } catch (e: any) {
      toast("error", e.message);
    } finally {
      setBusy(false);
    }
  }

  async function createUnit() {
    setBusy(true);
    try {
      await api("/api/units", {
        method: "POST",
        body: JSON.stringify({
          projectId: form.projectId,
          unitNumber: form.unitNumber,
          unitType: form.unitType || undefined,
          bedrooms: form.bedrooms ? Number(form.bedrooms) : undefined,
          areaSqm: form.areaSqm ? Number(form.areaSqm) : undefined,
          price: form.price ? Number(form.price) : undefined,
          floor: form.floor ? Number(form.floor) : undefined,
        }),
      });
      toast("success", "تمت إضافة الوحدة");
      setNewUnit(false);
      setForm({});
      loadUnits();
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
          <>
            <Button
              variant="outline"
              onClick={() => {
                setForm({});
                setNewProject(true);
              }}
            >
              <Plus size={14} /> مشروع
            </Button>
            <Button variant="outline" onClick={() => setImportOpen(true)} disabled={!projects?.length}>
              <Upload size={14} /> استيراد
            </Button>
            <Button
              onClick={() => {
                setForm({ projectId: projectId || projects?.[0]?.id });
                setNewUnit(true);
              }}
              disabled={!projects?.length}
            >
              <Plus size={14} /> وحدة
            </Button>
          </>
        }
      >
        المخزون العقاري
      </PageTitle>

      {projects?.length === 0 && (
        <EmptyState
          icon={<Building2 size={20} />}
          title="لا مشاريع بعد"
          hint="أضف مشروعك الأول، ثم وحداته — الأسعار والتوفر هنا هي المصدر الوحيد الذي يقرأ منه الذكاء الاصطناعي."
          action={<Button onClick={() => setNewProject(true)}>إنشاء مشروع</Button>}
        />
      )}

      {projects && projects.length > 0 && (
        <>
          <div className="mb-4 grid gap-3 md:grid-cols-3">
            {projects.map((p) => (
              <Card
                key={p.id}
                className={`cursor-pointer p-4 transition-colors ${projectId === p.id ? "border-primary" : "hover:border-primary/50"}`}
                onClick={() => setProjectId(projectId === p.id ? "" : p.id)}
              >
                <div className="text-[14px] font-bold">{p.name}</div>
                <div className="mt-1 text-[12px] text-dim">{p.location ?? "—"}</div>
                <div className="mt-2 flex gap-3 text-[11.5px] text-dim">
                  <span>{p._count.units} وحدة</span>
                  <span>{p._count.leads} عميل مهتم</span>
                </div>
              </Card>
            ))}
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="text-[15px] font-bold">
              الوحدات{" "}
              {projectId && (
                <span className="font-normal text-dim">
                  — {projects.find((p) => p.id === projectId)?.name}
                </span>
              )}
            </h2>
            {Object.entries(counts).map(([k, v]) => (
              <Badge key={k} tone={UNIT_STATUS[k]?.tone ?? "neutral"}>
                {UNIT_STATUS[k]?.label ?? k}: {v}
              </Badge>
            ))}
          </div>

          {!units && <Skeleton className="h-40" />}
          {units?.length === 0 && <p className="text-[13px] text-dim">لا وحدات في هذا النطاق.</p>}

          {units && units.length > 0 && (
            <Card className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-[13px]">
                <thead>
                  <tr className="border-b border-line bg-background/60 text-xs text-dim">
                    {["الوحدة", "المشروع", "النوع", "غرف", "المساحة", "السعر", "الحالة", ""].map((h) => (
                      <th key={h} className="px-4 py-2.5 text-start font-semibold">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {units.map((u) => (
                    <tr key={u.id} className="border-b border-line last:border-0">
                      <td className="px-4 py-2.5 font-semibold">{u.unitNumber}</td>
                      <td className="px-4 py-2.5 text-dim">{u.project.name}</td>
                      <td className="px-4 py-2.5">{u.unitType ?? "—"}</td>
                      <td className="px-4 py-2.5">{u.bedrooms ?? "—"}</td>
                      <td className="px-4 py-2.5">{u.areaSqm ? `${u.areaSqm} م²` : "—"}</td>
                      <td className="px-4 py-2.5 font-semibold">
                        {u.price ? `${Number(u.price).toLocaleString()} $` : "—"}
                      </td>
                      <td className="px-4 py-2.5">
                        <Select
                          className="h-7 w-36 text-[12px]"
                          value={u.status}
                          onChange={(e) => setStatus(u.id, e.target.value)}
                        >
                          {Object.entries(UNIT_STATUS).map(([k, v]) => (
                            <option key={k} value={k}>
                              {v.label}
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td className="px-2 py-2.5">
                        <button
                          className="text-dim transition-colors hover:text-primary"
                          onClick={() =>
                            setEditUnit({ ...u, price: u.price ?? "", areaSqm: u.areaSqm ?? "" })
                          }
                          aria-label={`تعديل الوحدة ${u.unitNumber}`}
                        >
                          <Pencil size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </>
      )}

      <Dialog
        open={editUnit !== null}
        onClose={() => setEditUnit(null)}
        title={`تعديل الوحدة ${editUnit?.unitNumber ?? ""}`}
        footer={
          <>
            <Button variant="danger" loading={busy} onClick={removeUnit} className="me-auto">
              <Trash2 size={13} /> حذف
            </Button>
            <Button variant="outline" onClick={() => setEditUnit(null)}>
              إلغاء
            </Button>
            <Button loading={busy} disabled={!editUnit?.unitNumber} onClick={saveUnit}>
              حفظ
            </Button>
          </>
        }
      >
        {editUnit && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="رقم الوحدة">
              <Input
                value={editUnit.unitNumber ?? ""}
                onChange={(e) => setEditUnit({ ...editUnit, unitNumber: e.target.value })}
              />
            </Field>
            <Field label="الطابق">
              <Input
                inputMode="numeric"
                value={editUnit.floor ?? ""}
                onChange={(e) => setEditUnit({ ...editUnit, floor: e.target.value })}
              />
            </Field>
            <Field label="النوع">
              <Input
                value={editUnit.unitType ?? ""}
                onChange={(e) => setEditUnit({ ...editUnit, unitType: e.target.value })}
              />
            </Field>
            <Field label="غرف النوم">
              <Input
                inputMode="numeric"
                value={editUnit.bedrooms ?? ""}
                onChange={(e) => setEditUnit({ ...editUnit, bedrooms: e.target.value })}
              />
            </Field>
            <Field label="الحمامات">
              <Input
                inputMode="numeric"
                value={editUnit.bathrooms ?? ""}
                onChange={(e) => setEditUnit({ ...editUnit, bathrooms: e.target.value })}
              />
            </Field>
            <Field label="المساحة (م²)">
              <Input
                inputMode="numeric"
                value={editUnit.areaSqm ?? ""}
                onChange={(e) => setEditUnit({ ...editUnit, areaSqm: e.target.value })}
              />
            </Field>
            <div className="col-span-2">
              <Field label="السعر ($)">
                <Input
                  inputMode="numeric"
                  value={editUnit.price ?? ""}
                  onChange={(e) => setEditUnit({ ...editUnit, price: e.target.value })}
                />
              </Field>
              <p className="mt-1.5 text-[11.5px] text-dim">
                تغيير السعر يُسجَّل في تاريخ الوحدة — لأنه رقم يُقتبس للعملاء.
              </p>
            </div>
          </div>
        )}
      </Dialog>

      <ImportUnitsDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        projects={projects ?? []}
        onImported={() => {
          loadProjects();
          loadUnits();
        }}
      />

      <Dialog
        open={newProject}
        onClose={() => setNewProject(false)}
        title="مشروع جديد"
        footer={
          <>
            <Button variant="outline" onClick={() => setNewProject(false)}>
              إلغاء
            </Button>
            <Button loading={busy} disabled={!form.name} onClick={createProject}>
              إنشاء
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          <Field label="اسم المشروع">
            <Input
              value={form.name ?? ""}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              autoFocus
            />
          </Field>
          <Field label="الموقع">
            <Input
              value={form.location ?? ""}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
              placeholder="بغداد — المنصور"
            />
          </Field>
          <Field label="المطوّر">
            <Input
              value={form.developer ?? ""}
              onChange={(e) => setForm({ ...form, developer: e.target.value })}
            />
          </Field>
          <Field label="النوع">
            <Input
              value={form.projectType ?? ""}
              onChange={(e) => setForm({ ...form, projectType: e.target.value })}
              placeholder="سكني / تجاري"
            />
          </Field>
        </div>
      </Dialog>

      <Dialog
        open={newUnit}
        onClose={() => setNewUnit(false)}
        title="وحدة جديدة"
        footer={
          <>
            <Button variant="outline" onClick={() => setNewUnit(false)}>
              إلغاء
            </Button>
            <Button loading={busy} disabled={!form.projectId || !form.unitNumber} onClick={createUnit}>
              إضافة
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          <Field label="المشروع">
            <Select
              value={form.projectId ?? ""}
              onChange={(e) => setForm({ ...form, projectId: e.target.value })}
            >
              {projects?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="رقم الوحدة">
              <Input
                value={form.unitNumber ?? ""}
                onChange={(e) => setForm({ ...form, unitNumber: e.target.value })}
                placeholder="A-101"
              />
            </Field>
            <Field label="الطابق">
              <Input
                inputMode="numeric"
                value={form.floor ?? ""}
                onChange={(e) => setForm({ ...form, floor: e.target.value })}
              />
            </Field>
            <Field label="النوع">
              <Input
                value={form.unitType ?? ""}
                onChange={(e) => setForm({ ...form, unitType: e.target.value })}
                placeholder="شقة"
              />
            </Field>
            <Field label="غرف النوم">
              <Input
                inputMode="numeric"
                value={form.bedrooms ?? ""}
                onChange={(e) => setForm({ ...form, bedrooms: e.target.value })}
              />
            </Field>
            <Field label="المساحة (م²)">
              <Input
                inputMode="numeric"
                value={form.areaSqm ?? ""}
                onChange={(e) => setForm({ ...form, areaSqm: e.target.value })}
              />
            </Field>
            <Field label="السعر ($)">
              <Input
                inputMode="numeric"
                value={form.price ?? ""}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
              />
            </Field>
          </div>
        </div>
      </Dialog>
    </Shell>
  );
}
