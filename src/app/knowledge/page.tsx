"use client";
import { useCallback, useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { Modal, Field, Notice, dateTime } from "@/components/ui";
import { api } from "@/lib/client";

const TYPE_LABEL: Record<string, string> = { PDF: "PDF", DOCX: "Word", CSV: "CSV", TEXT: "نص", URL: "رابط", XLSX: "Excel" };
const STATUS_LABEL: Record<string, string> = { ACTIVE: "مفعّل", DISABLED: "معطّل", PROCESSING: "قيد المعالجة", FAILED: "فشل" };

export default function KnowledgePage() {
  const [items, setItems] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [adding, setAdding] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [k, p] = await Promise.all([api("/api/knowledge-sources"), api("/api/projects?pageSize=100")]);
    setItems(k.items);
    setProjects(p.items);
  }, []);
  useEffect(() => { load().catch((e) => setError(e.message)); }, [load]);

  return (
    <Shell>
      <div className="toolbar">
        <h1 className="page-title">قاعدة المعرفة</h1>
        <button className="btn" onClick={() => setAdding(true)}>إضافة مصدر</button>
      </div>
      <p className="muted small" style={{ marginBottom: 14 }}>
        ما تضيفه هنا يستخدمه الذكاء الاصطناعي للرد على العملاء: كتيّبات المشاريع، خطط الدفع، الأسئلة الشائعة. الأسعار وتوفّر الوحدات تُقرأ من شاشة المخزون فقط، لا من هذه الملفات.
      </p>
      <Notice kind="err">{error}</Notice>
      <Notice kind="ok">{msg}</Notice>

      <SearchTester projects={projects} />

      <div className="table-wrap" style={{ marginTop: 16 }}>
        {items.length === 0 ? <div className="empty">لا توجد مصادر بعد. ارفع كتيّب مشروع أو الصق أسئلة شائعة.</div> : (
          <table className="data">
            <thead><tr><th>العنوان</th><th>النوع</th><th>المشروع</th><th>المقاطع</th><th>النسخة</th><th>الحالة</th><th>أُضيف</th></tr></thead>
            <tbody>
              {items.map((s) => (
                <tr key={s.id} className="clickable" onClick={() => setViewing(s.id)}>
                  <td style={{ fontWeight: 600 }}>{s.title}</td>
                  <td>{TYPE_LABEL[s.type] ?? s.type}</td>
                  <td>{s.project?.name ?? "كل المشاريع"}</td>
                  <td>{s._count?.documents ?? 0}</td>
                  <td>{s.version}</td>
                  <td><span className={`chip ${s.status === "ACTIVE" ? "member-ACTIVE" : "member-SUSPENDED"}`}>{STATUS_LABEL[s.status] ?? s.status}</span></td>
                  <td className="small muted">{dateTime(s.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {adding && (
        <AddSourceModal projects={projects} onClose={() => setAdding(false)}
          onSaved={async (r) => { setAdding(false); setMsg(`أُضيف «${r.title}» — ${r.chunks} مقطعاً جاهزاً للذكاء الاصطناعي`); await load(); }} />
      )}
      {viewing && (
        <SourceModal id={viewing} projects={projects} onClose={() => setViewing(null)}
          onChanged={async (m) => { setMsg(m); await load(); }} />
      )}
    </Shell>
  );
}

function SearchTester({ projects }: { projects: any[] }) {
  const [q, setQ] = useState("");
  const [projectId, setProjectId] = useState("");
  const [results, setResults] = useState<any[] | null>(null);
  const [error, setError] = useState("");

  async function run() {
    setError("");
    try {
      const params = new URLSearchParams({ q });
      if (projectId) params.set("projectId", projectId);
      setResults((await api(`/api/knowledge-sources/search?${params}`)).items);
    } catch (e: any) { setError(e.message); }
  }

  return (
    <div className="card">
      <div className="section-title">جرّب سؤال عميل</div>
      <div className="row">
        <input className="input" style={{ flex: 1, minWidth: 200 }} placeholder="مثال: شنو خطة الدفع لشقق برج A؟" value={q}
          onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && q.trim().length > 1 && run()} />
        <select className="input" style={{ width: "auto" }} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">كل المشاريع</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button className="btn" disabled={q.trim().length < 2} onClick={run}>بحث</button>
      </div>
      <Notice kind="err">{error}</Notice>
      {results && (
        <div className="stack" style={{ marginTop: 12 }}>
          {results.length === 0
            ? <p className="muted small">لم يجد الذكاء الاصطناعي شيئاً — سيحوّل هذا السؤال لموظف. أضف مصدراً يغطيه.</p>
            : results.map((r, i) => (
              <div key={i} className="timeline">
                <div className="item">
                  <div className="small muted">من: {r.sourceTitle}</div>
                  <div className="small" style={{ whiteSpace: "pre-wrap", lineHeight: 1.7 }}>{r.content.slice(0, 400)}{r.content.length > 400 ? "…" : ""}</div>
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

function AddSourceModal({ projects, onClose, onSaved }: { projects: any[]; onClose: () => void; onSaved: (r: any) => void }) {
  const [mode, setMode] = useState<"file" | "text">("file");
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [projectId, setProjectId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    setError(""); setBusy(true);
    try {
      let r;
      if (mode === "file") {
        const form = new FormData();
        form.set("file", file!);
        if (title) form.set("title", title);
        if (projectId) form.set("projectId", projectId);
        r = await api("/api/knowledge-sources", { method: "POST", body: form });
      } else {
        r = await api("/api/knowledge-sources", {
          method: "POST",
          body: JSON.stringify({ title, type: "TEXT", content, ...(projectId ? { projectId } : {}) }),
        });
      }
      onSaved(r);
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  }

  const ready = mode === "file" ? !!file : title.trim().length >= 2 && content.trim().length >= 10;

  return (
    <Modal title="إضافة مصدر معرفة" onClose={onClose}>
      <div className="tabs">
        <button className={`tab ${mode === "file" ? "active" : ""}`} onClick={() => setMode("file")}>رفع ملف</button>
        <button className={`tab ${mode === "text" ? "active" : ""}`} onClick={() => setMode("text")}>لصق نص</button>
      </div>
      <div className="stack">
        {mode === "file" ? (
          <Field label="الملف (PDF، Word، TXT، CSV — حتى 10MB)">
            <input type="file" accept=".pdf,.docx,.txt,.md,.csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </Field>
        ) : null}
        <Field label={mode === "file" ? "العنوان (اختياري — يُؤخذ من اسم الملف)" : "العنوان *"}>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        {mode === "text" && (
          <Field label="النص *"><textarea className="input" style={{ minHeight: 180 }} value={content} onChange={(e) => setContent(e.target.value)} /></Field>
        )}
        <Field label="يخص مشروعاً محدداً؟">
          <select className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">لا — يُستخدم لكل المشاريع</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
      </div>
      <Notice kind="err">{error}</Notice>
      <div className="form-actions">
        <button className="btn" disabled={!ready || busy} onClick={save}>{busy ? "جارٍ المعالجة…" : "إضافة"}</button>
        <button className="btn plain" onClick={onClose}>إلغاء</button>
      </div>
    </Modal>
  );
}

function SourceModal({ id, projects, onClose, onChanged }: { id: string; projects: any[]; onClose: () => void; onChanged: (msg: string) => void }) {
  const [source, setSource] = useState<any>(null);
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => setSource(await api(`/api/knowledge-sources/${id}`)), [id]);
  useEffect(() => { load().catch((e) => setError(e.message)); }, [load]);

  async function patch(body: any, message: string) {
    setError("");
    try {
      await api(`/api/knowledge-sources/${id}`, { method: "PATCH", body: JSON.stringify(body) });
      await load();
      onChanged(message);
    } catch (e: any) { setError(e.message); }
  }

  async function remove() {
    if (!confirm(`حذف «${source.title}» نهائياً؟ لن يستخدمه الذكاء الاصطناعي بعد الآن.`)) return;
    try {
      await api(`/api/knowledge-sources/${id}`, { method: "DELETE" });
      onChanged("تم حذف المصدر");
      onClose();
    } catch (e: any) { setError(e.message); }
  }

  if (!source) return <Modal title="جارٍ التحميل…" onClose={onClose}><Notice kind="err">{error}</Notice></Modal>;

  return (
    <Modal title={source.title} onClose={onClose}>
      <div className="row" style={{ marginBottom: 12 }}>
        <span className={`chip ${source.status === "ACTIVE" ? "member-ACTIVE" : "member-SUSPENDED"}`}>{STATUS_LABEL[source.status]}</span>
        <span className="chip">نسخة {source.version}</span>
        <span className="chip">{source.documents.length} مقطعاً</span>
        <select className="input sm" style={{ width: "auto" }} value={source.projectId ?? ""}
          onChange={(e) => patch({ projectId: e.target.value || null }, "تم تغيير المشروع")}>
          <option value="">كل المشاريع</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <Notice kind="err">{error}</Notice>

      {editing ? (
        <div className="stack">
          <Field label="المحتوى الجديد (يستبدل القديم وينشئ نسخة جديدة)">
            <textarea className="input" style={{ minHeight: 220 }} value={content} onChange={(e) => setContent(e.target.value)} />
          </Field>
          <div className="form-actions">
            <button className="btn" disabled={content.trim().length < 10}
              onClick={async () => { await patch({ content }, "تم تحديث المحتوى"); setEditing(false); }}>حفظ نسخة جديدة</button>
            <button className="btn plain" onClick={() => setEditing(false)}>إلغاء</button>
          </div>
        </div>
      ) : (
        <>
          <div className="section-title">ما يقرؤه الذكاء الاصطناعي</div>
          <div style={{ maxHeight: 340, overflowY: "auto" }} className="stack">
            {source.documents.map((d: any) => (
              <div key={d.id} className="timeline"><div className="item">
                <div className="small muted">مقطع {d.chunkIndex + 1}</div>
                <div className="small" style={{ whiteSpace: "pre-wrap", lineHeight: 1.7 }}>{d.content}</div>
              </div></div>
            ))}
          </div>
          <div className="form-actions">
            {source.status === "ACTIVE"
              ? <button className="btn plain" onClick={() => patch({ status: "DISABLED" }, "عُطّل المصدر — لن يستخدمه الذكاء الاصطناعي")}>تعطيل</button>
              : <button className="btn" onClick={() => patch({ status: "ACTIVE" }, "فُعّل المصدر")}>تفعيل</button>}
            <button className="btn plain" onClick={() => { setContent(source.documents.map((d: any) => d.content).join("\n\n")); setEditing(true); }}>تعديل المحتوى</button>
            <button className="btn ghost danger" onClick={remove}>حذف</button>
          </div>
        </>
      )}
    </Modal>
  );
}
