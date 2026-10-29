"use client";
import { useCallback, useEffect, useState } from "react";
import Shell, { can, useRole } from "@/components/Shell";
import { Modal, Field, Notice, UNIT_STATUS_LABEL, money } from "@/components/ui";
import { api } from "@/lib/client";

const STATUSES = Object.keys(UNIT_STATUS_LABEL);
const PROJECT_STATUS: Record<string, string> = {
  PLANNING: "تخطيط",
  UNDER_CONSTRUCTION: "قيد الإنشاء",
  READY: "جاهز",
  DELIVERED: "مُسلَّم",
};
const PAGE_SIZE = 100;

type Project = { id: string; name: string; location?: string | null; status: string; _count?: { units: number; leads: number } };

export default function InventoryPage() {
  const role = useRole();
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string>("");
  const [project, setProject] = useState<any>(null);
  const [units, setUnits] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [modal, setModal] = useState<null | { kind: "project"; data?: any } | { kind: "unit"; data?: any } | { kind: "import" }>(null);

  const loadProjects = useCallback(async () => {
    const data = await api("/api/projects?pageSize=100");
    setProjects(data.items);
    setProjectId((cur) => cur || data.items[0]?.id || "");
  }, []);

  const loadUnits = useCallback(async () => {
    if (!projectId) return;
    const params = new URLSearchParams({ projectId, page: String(page), pageSize: String(PAGE_SIZE) });
    if (status) params.set("status", status);
    if (q.trim()) params.set("q", q.trim());
    const [p, u] = await Promise.all([api(`/api/projects/${projectId}`), api(`/api/units?${params}`)]);
    setProject(p);
    setUnits(u.items);
    setTotal(u.total);
  }, [projectId, page, status, q]);

  useEffect(() => { loadProjects().catch((e) => setError(e.message)); }, [loadProjects]);
  useEffect(() => { loadUnits().catch((e) => setError(e.message)); }, [loadUnits]);

  async function changeStatus(unitId: string, next: string) {
    try {
      await api(`/api/units/${unitId}`, { method: "PATCH", body: JSON.stringify({ status: next }) });
      setMsg("تم تحديث الحالة — الذكاء الاصطناعي يقرأ الحالة الجديدة فوراً");
      await loadUnits();
    } catch (e: any) { setError(e.message); }
  }

  const canManageProjects = can(role, "projects.manage");

  return (
    <Shell>
      <div className="toolbar">
        <h1 className="page-title">المشاريع والوحدات</h1>
        <div className="row">
          {canManageProjects && <button className="btn ghost" onClick={() => setModal({ kind: "project" })}>مشروع جديد</button>}
          {projectId && <button className="btn ghost" onClick={() => setModal({ kind: "import" })}>استيراد من Excel</button>}
          {projectId && <button className="btn" onClick={() => setModal({ kind: "unit" })}>إضافة وحدة</button>}
        </div>
      </div>

      <Notice kind="err">{error}</Notice>
      <Notice kind="ok">{msg}</Notice>

      {projects.length === 0 ? (
        <div className="card empty">لا توجد مشاريع بعد. أضف أول مشروع ثم وحداته.</div>
      ) : (
        <div className="stack">
          <div className="card spread">
            <div className="row">
              <select className="input" style={{ width: "auto", minWidth: 220 }} value={projectId}
                onChange={(e) => { setProjectId(e.target.value); setPage(1); }}>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              {project && <span className="chip">{PROJECT_STATUS[project.status] ?? project.status}</span>}
              {project?.location && <span className="muted small">{project.location}</span>}
            </div>
            {project && canManageProjects && (
              <button className="btn sm plain" onClick={() => setModal({ kind: "project", data: project })}>تعديل المشروع</button>
            )}
          </div>

          {project && (
            <div className="row">
              {STATUSES.map((s) => (
                <button key={s} className={`chip unit-${s}`} style={{ border: status === s ? "1px solid currentColor" : "1px solid transparent", cursor: "pointer" }}
                  onClick={() => { setStatus(status === s ? "" : s); setPage(1); }}>
                  {UNIT_STATUS_LABEL[s]}: {project.unitCounts?.[s] ?? 0}
                </button>
              ))}
              <input className="input sm" style={{ width: 200 }} placeholder="بحث برقم الوحدة أو النوع" value={q}
                onChange={(e) => { setQ(e.target.value); setPage(1); }} />
            </div>
          )}

          <div className="table-wrap">
            {units.length === 0 ? <div className="empty">لا توجد وحدات بهذا الفلتر.</div> : (
              <table className="data">
                <thead>
                  <tr><th>الوحدة</th><th>المبنى</th><th>الطابق</th><th>النوع</th><th>الغرف</th><th>المساحة م²</th><th>السعر</th><th>الحالة</th><th></th></tr>
                </thead>
                <tbody>
                  {units.map((u) => (
                    <tr key={u.id}>
                      <td style={{ fontWeight: 600 }}>{u.unitNumber}</td>
                      <td>{u.building?.name ?? "—"}</td>
                      <td>{u.floor ?? "—"}</td>
                      <td>{u.unitType ?? "—"}</td>
                      <td>{u.bedrooms ?? "—"}</td>
                      <td>{u.areaSqm ? money(u.areaSqm) : "—"}</td>
                      <td className="ltr">{money(u.price)}</td>
                      <td>
                        <select className={`input sm chip unit-${u.status}`} style={{ width: "auto" }} value={u.status}
                          onChange={(e) => changeStatus(u.id, e.target.value)} aria-label={`حالة الوحدة ${u.unitNumber}`}>
                          {STATUSES.map((s) => <option key={s} value={s}>{UNIT_STATUS_LABEL[s]}</option>)}
                        </select>
                      </td>
                      <td><button className="btn sm plain" onClick={() => setModal({ kind: "unit", data: u })}>تعديل</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {total > PAGE_SIZE && (
            <div className="row">
              <button className="btn sm plain" disabled={page <= 1} onClick={() => setPage(page - 1)}>السابق</button>
              <span className="muted small">صفحة {page} من {Math.ceil(total / PAGE_SIZE)} · {total} وحدة</span>
              <button className="btn sm plain" disabled={page * PAGE_SIZE >= total} onClick={() => setPage(page + 1)}>التالي</button>
            </div>
          )}
        </div>
      )}

      {modal?.kind === "project" && (
        <ProjectModal data={modal.data} onClose={() => setModal(null)}
          onSaved={async (p) => { setModal(null); await loadProjects(); setProjectId(p.id); setMsg("تم حفظ المشروع"); }} />
      )}
      {modal?.kind === "unit" && project && (
        <UnitModal project={project} data={modal.data} onClose={() => setModal(null)}
          onSaved={async () => { setModal(null); setMsg("تم حفظ الوحدة"); await loadUnits(); }} />
      )}
      {modal?.kind === "import" && project && (
        <ImportModal project={project} onClose={() => setModal(null)}
          onDone={async (r) => { setModal(null); setMsg(`تم الاستيراد: ${r.created} جديدة، ${r.updated} محدّثة${r.errors.length ? `، ${r.errors.length} أخطاء` : ""}`); await loadUnits(); }} />
      )}
    </Shell>
  );
}

function ProjectModal({ data, onClose, onSaved }: { data?: any; onClose: () => void; onSaved: (p: any) => void }) {
  const [f, setF] = useState({
    name: data?.name ?? "", location: data?.location ?? "", developer: data?.developer ?? "",
    projectType: data?.projectType ?? "", status: data?.status ?? "PLANNING",
    startingPrice: data?.startingPrice ?? "", deliveryDate: data?.deliveryDate?.slice(0, 10) ?? "",
    description: data?.description ?? "",
  });
  const [error, setError] = useState("");
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });

  async function save() {
    setError("");
    const body: any = {
      name: f.name, location: f.location || null, developer: f.developer || null, projectType: f.projectType || null,
      description: f.description || null,
      startingPrice: f.startingPrice === "" ? null : Number(f.startingPrice),
      deliveryDate: f.deliveryDate || null,
    };
    try {
      const saved = data
        ? await api(`/api/projects/${data.id}`, { method: "PATCH", body: JSON.stringify({ ...body, status: f.status }) })
        : await api("/api/projects", { method: "POST", body: JSON.stringify(Object.fromEntries(Object.entries(body).filter(([, v]) => v !== null))) });
      onSaved(saved);
    } catch (e: any) { setError(e.message); }
  }

  return (
    <Modal title={data ? "تعديل المشروع" : "مشروع جديد"} onClose={onClose}>
      <div className="form-grid">
        <Field label="اسم المشروع *"><input className="input" value={f.name} onChange={set("name")} /></Field>
        <Field label="الموقع"><input className="input" value={f.location} onChange={set("location")} /></Field>
        <Field label="المطوّر"><input className="input" value={f.developer} onChange={set("developer")} /></Field>
        <Field label="نوع المشروع"><input className="input" placeholder="سكني، تجاري…" value={f.projectType} onChange={set("projectType")} /></Field>
        {data && (
          <Field label="الحالة">
            <select className="input" value={f.status} onChange={set("status")}>
              {Object.entries(PROJECT_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
        )}
        <Field label="السعر الابتدائي"><input className="input ltr" inputMode="decimal" value={f.startingPrice} onChange={set("startingPrice")} /></Field>
        <Field label="موعد التسليم"><input className="input" type="date" value={f.deliveryDate} onChange={set("deliveryDate")} /></Field>
      </div>
      <div style={{ marginTop: 12 }}>
        <Field label="الوصف (يقرؤه الذكاء الاصطناعي)"><textarea className="input" value={f.description} onChange={set("description")} /></Field>
      </div>
      <Notice kind="err">{error}</Notice>
      <div className="form-actions">
        <button className="btn" onClick={save} disabled={f.name.trim().length < 2}>حفظ</button>
        <button className="btn plain" onClick={onClose}>إلغاء</button>
      </div>
    </Modal>
  );
}

function UnitModal({ project, data, onClose, onSaved }: { project: any; data?: any; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    unitNumber: data?.unitNumber ?? "", buildingName: data?.building?.name ?? "", floor: data?.floor ?? "",
    unitType: data?.unitType ?? "", bedrooms: data?.bedrooms ?? "", bathrooms: data?.bathrooms ?? "",
    areaSqm: data?.areaSqm ?? "", price: data?.price ?? "", status: data?.status ?? "AVAILABLE", notes: data?.notes ?? "",
  });
  const [error, setError] = useState("");
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });

  async function save() {
    setError("");
    const body = { ...f, ...(data ? {} : { projectId: project.id }) };
    try {
      if (data) await api(`/api/units/${data.id}`, { method: "PATCH", body: JSON.stringify(body) });
      else await api("/api/units", { method: "POST", body: JSON.stringify(body) });
      onSaved();
    } catch (e: any) { setError(e.message); }
  }

  return (
    <Modal title={data ? `تعديل الوحدة ${data.unitNumber}` : `وحدة جديدة في ${project.name}`} onClose={onClose}>
      <div className="form-grid">
        <Field label="رقم الوحدة *"><input className="input" value={f.unitNumber} onChange={set("unitNumber")} /></Field>
        <Field label="المبنى">
          <input className="input" list="buildings" value={f.buildingName} onChange={set("buildingName")} />
          <datalist id="buildings">{project.buildings?.map((b: any) => <option key={b.id} value={b.name} />)}</datalist>
        </Field>
        <Field label="الطابق"><input className="input" inputMode="numeric" value={f.floor} onChange={set("floor")} /></Field>
        <Field label="النوع"><input className="input" placeholder="شقة، فيلا، محل…" value={f.unitType} onChange={set("unitType")} /></Field>
        <Field label="غرف النوم"><input className="input" inputMode="numeric" value={f.bedrooms} onChange={set("bedrooms")} /></Field>
        <Field label="الحمامات"><input className="input" inputMode="numeric" value={f.bathrooms} onChange={set("bathrooms")} /></Field>
        <Field label="المساحة م²"><input className="input ltr" inputMode="decimal" value={f.areaSqm} onChange={set("areaSqm")} /></Field>
        <Field label="السعر"><input className="input ltr" inputMode="decimal" value={f.price} onChange={set("price")} /></Field>
        <Field label="الحالة">
          <select className="input" value={f.status} onChange={set("status")}>
            {STATUSES.map((s) => <option key={s} value={s}>{UNIT_STATUS_LABEL[s]}</option>)}
          </select>
        </Field>
      </div>
      <div style={{ marginTop: 12 }}>
        <Field label="ملاحظات"><textarea className="input" style={{ minHeight: 70 }} value={f.notes} onChange={set("notes")} /></Field>
      </div>
      <p className="muted small" style={{ marginTop: 8 }}>كل تغيير في السعر أو الحالة يُسجَّل في سجل الوحدة، والذكاء الاصطناعي يقرأ القيمة الجديدة فوراً.</p>
      <Notice kind="err">{error}</Notice>
      <div className="form-actions">
        <button className="btn" onClick={save} disabled={!String(f.unitNumber).trim()}>حفظ</button>
        <button className="btn plain" onClick={onClose}>إلغاء</button>
      </div>
    </Modal>
  );
}

function ImportModal({ project, onClose, onDone }: { project: any; onClose: () => void; onDone: (r: any) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function send(dryRun: boolean) {
    if (!file) return;
    setError(""); setBusy(true);
    const form = new FormData();
    form.set("file", file);
    form.set("projectId", project.id);
    if (dryRun) form.set("dryRun", "1");
    try {
      const r = await api("/api/units/import", { method: "POST", body: form });
      if (dryRun) setPreview(r); else onDone(r);
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  }

  function downloadTemplate() {
    const csv = "﻿رقم الوحدة,المبنى,الطابق,النوع,غرف النوم,الحمامات,المساحة,السعر,الحالة,ملاحظات\nA-101,برج A,1,شقة,2,2,120,95000,متاحة,\n";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = "leadra-units-template.csv";
    a.click();
  }

  return (
    <Modal title={`استيراد وحدات إلى ${project.name}`} onClose={onClose}>
      <p className="muted small" style={{ marginBottom: 12 }}>
        ملف CSV أو Excel (.xlsx). الوحدة الموجودة بنفس الرقم تُحدَّث، والجديدة تُضاف. الأعمدة بالعربي أو الإنجليزي.
      </p>
      <div className="row" style={{ marginBottom: 12 }}>
        <input type="file" accept=".csv,.xlsx" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); }} />
        <button className="btn sm plain" onClick={downloadTemplate}>تحميل القالب</button>
      </div>
      {preview && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="row">
            <span className="chip unit-AVAILABLE">جديدة: {preview.toCreate}</span>
            <span className="chip unit-RESERVED">تحديث: {preview.toUpdate}</span>
            {preview.errors.length > 0 && <span className="chip unit-UNAVAILABLE">أخطاء: {preview.errors.length}</span>}
          </div>
          {preview.unknownHeaders.length > 0 && <p className="small muted" style={{ marginTop: 8 }}>أعمدة لن تُستورد: {preview.unknownHeaders.join("، ")}</p>}
          {preview.errors.slice(0, 8).map((e: any) => <p key={e.line} className="small error-text">سطر {e.line}: {e.message}</p>)}
        </div>
      )}
      <Notice kind="err">{error}</Notice>
      <div className="form-actions">
        {!preview
          ? <button className="btn" disabled={!file || busy} onClick={() => send(true)}>{busy ? "جارٍ الفحص…" : "فحص الملف"}</button>
          : <button className="btn" disabled={busy || preview.toCreate + preview.toUpdate === 0} onClick={() => send(false)}>{busy ? "جارٍ الاستيراد…" : "تأكيد الاستيراد"}</button>}
        <button className="btn plain" onClick={onClose}>إلغاء</button>
      </div>
    </Modal>
  );
}
