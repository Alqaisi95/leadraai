"use client";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Shell from "@/components/Shell";
import { Field, Notice, PURPOSE_LABEL, TEMPERATURE_LABEL, money, dateTime } from "@/components/ui";
import { api } from "@/lib/client";

const CONV_STATUS: Record<string, string> = {
  AI_ACTIVE: "الذكاء الاصطناعي يرد", NEEDS_HUMAN: "يحتاج موظفاً", ASSIGNED_TO_AGENT: "محوّلة لموظف",
  AGENT_ACTIVE: "موظف يرد", FOLLOW_UP_PENDING: "بانتظار متابعة", CLOSED: "مغلقة", SPAM: "مزعجة",
};
const SENDER: Record<string, string> = { CUSTOMER: "العميل", AI: "الذكاء الاصطناعي", AGENT: "موظف", SYSTEM: "النظام" };

export default function LeadPage() {
  const { id } = useParams<{ id: string }>();
  const [lead, setLead] = useState<any>(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => setLead(await api(`/api/leads/${id}`)), [id]);
  useEffect(() => { load().catch((e) => setError(e.code === "NOT_FOUND" ? "العميل غير موجود أو غير مسند إليك" : e.message)); }, [load]);

  if (!lead) return <Shell><Notice kind="err">{error}</Notice>{!error && <p className="muted">جارٍ التحميل…</p>}</Shell>;

  const name = lead.fullName ?? lead.igUsername ?? "عميل";
  const opp = lead.opportunities?.[0];

  return (
    <Shell>
      <div className="toolbar">
        <div>
          <a href="/leads" className="small muted">→ العملاء والمسار</a>
          <h1 className="page-title" style={{ marginTop: 4 }}>{name}</h1>
        </div>
        <div className="row">
          <span className={`score-badge score-${lead.temperature}`}>{lead.score} · {TEMPERATURE_LABEL[lead.temperature]}</span>
          {opp && <span className="chip">{opp.stage.name}</span>}
          {lead.igUsername && <span className="chip ltr">@{lead.igUsername}</span>}
        </div>
      </div>
      <Notice kind="err">{error}</Notice>
      <Notice kind="ok">{msg}</Notice>

      <div className="two-col">
        <div className="stack">
          <Conversation conversation={lead.conversation} />
          <Notes lead={lead} onAdded={async () => { await load(); }} />
          <Tasks lead={lead} onChanged={load} />
          <ScoreHistory events={lead.scoreEvents} />
        </div>
        <div className="stack">
          <Details lead={lead} onSaved={async () => { setMsg("تم حفظ البيانات"); await load(); }} onError={setError} />
          <Matches leadId={lead.id} />
          <Appointments lead={lead} onChanged={async () => { setMsg("أُضيف الموعد"); await load(); }} />
        </div>
      </div>
    </Shell>
  );
}

function Conversation({ conversation }: { conversation: any }) {
  if (!conversation) return <div className="card muted small">لا توجد محادثة Instagram مرتبطة — أُضيف هذا العميل يدوياً.</div>;
  return (
    <div className="card">
      <div className="spread" style={{ marginBottom: 10 }}>
        <div className="section-title" style={{ marginBottom: 0 }}>المحادثة</div>
        <div className="row">
          <span className={`status-pill status-${conversation.status}`}>{CONV_STATUS[conversation.status] ?? conversation.status}</span>
          <a className="btn sm ghost" href={`/inbox?c=${conversation.id}`}>فتح في صندوق المحادثات</a>
        </div>
      </div>
      <div className="thread-messages" style={{ maxHeight: 420, padding: 4 }}>
        {conversation.messages.length === 0 && <p className="muted small">لا رسائل.</p>}
        {conversation.messages.map((m: any) => (
          <div key={m.id} className={`bubble ${m.senderType}`}>
            <div style={{ whiteSpace: "pre-wrap" }}>{m.body ?? "[مرفق]"}</div>
            <div className="meta">{SENDER[m.senderType]} · {dateTime(m.createdAt)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Details({ lead, onSaved, onError }: { lead: any; onSaved: () => void; onError: (e: string) => void }) {
  const [projects, setProjects] = useState<any[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const init = () => ({
    fullName: lead.fullName ?? "", phone: lead.phone ?? "", email: lead.email ?? "", purpose: lead.purpose,
    city: lead.city ?? "", area: lead.area ?? "", propertyType: lead.propertyType ?? "",
    budgetMin: lead.budgetMin ?? "", budgetMax: lead.budgetMax ?? "", paymentMethod: lead.paymentMethod ?? "",
    buyTimeframe: lead.buyTimeframe ?? "", nextStep: lead.nextStep ?? "",
    interestedProjectId: lead.interestedProjectId ?? "", ownerMemberId: lead.ownerMemberId ?? "",
  });
  const [f, setF] = useState(init);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { setF(init()); setDirty(false); }, [lead]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    api("/api/projects?pageSize=100").then((r) => setProjects(r.items)).catch(() => {});
    if (lead.canAssign) api("/api/members/assignable").then((r) => setMembers(r.items)).catch(() => {});
  }, [lead.canAssign]);
  const set = (k: string) => (e: any) => { setF({ ...f, [k]: e.target.value }); setDirty(true); };

  async function save() {
    const num = (v: any) => (v === "" || v === null ? null : Number(v));
    const body: any = {
      ...f, budgetMin: num(f.budgetMin), budgetMax: num(f.budgetMax),
      interestedProjectId: f.interestedProjectId || null,
    };
    if (lead.canAssign) body.ownerMemberId = f.ownerMemberId || null; else delete body.ownerMemberId;
    try { await api(`/api/leads/${lead.id}`, { method: "PATCH", body: JSON.stringify(body) }); onSaved(); }
    catch (e: any) { onError(e.message); }
  }

  return (
    <div className="card">
      <div className="section-title">البيانات</div>
      <div className="stack" style={{ gap: 10 }}>
        <Field label="الاسم"><input className="input" value={f.fullName} onChange={set("fullName")} /></Field>
        <Field label="الهاتف"><input className="input ltr" value={f.phone} onChange={set("phone")} /></Field>
        <Field label="البريد"><input className="input ltr" value={f.email} onChange={set("email")} /></Field>
        <Field label="الغرض">
          <select className="input" value={f.purpose} onChange={set("purpose")}>
            {Object.entries(PURPOSE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="المشروع المهتم به">
          <select className="input" value={f.interestedProjectId} onChange={set("interestedProjectId")}>
            <option value="">—</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <div className="form-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <Field label="المدينة"><input className="input" value={f.city} onChange={set("city")} /></Field>
          <Field label="المنطقة"><input className="input" value={f.area} onChange={set("area")} /></Field>
          <Field label="الميزانية من"><input className="input ltr" inputMode="decimal" value={f.budgetMin} onChange={set("budgetMin")} /></Field>
          <Field label="إلى"><input className="input ltr" inputMode="decimal" value={f.budgetMax} onChange={set("budgetMax")} /></Field>
          <Field label="نوع العقار"><input className="input" value={f.propertyType} onChange={set("propertyType")} /></Field>
          <Field label="طريقة الدفع"><input className="input" value={f.paymentMethod} onChange={set("paymentMethod")} /></Field>
        </div>
        <Field label="موعد الشراء المتوقع"><input className="input" value={f.buyTimeframe} onChange={set("buyTimeframe")} /></Field>
        <Field label="الخطوة التالية"><input className="input" value={f.nextStep} onChange={set("nextStep")} /></Field>
        {lead.canAssign ? (
          <Field label="الموظف المسؤول">
            <select className="input" value={f.ownerMemberId} onChange={set("ownerMemberId")}>
              <option value="">غير مسند</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.fullName}</option>)}
            </select>
          </Field>
        ) : <p className="small muted">المسؤول: {lead.owner?.user.fullName ?? "غير مسند"}</p>}
        {lead.campaign && <p className="small muted">المصدر: {lead.campaign.name}</p>}
      </div>
      <div className="form-actions"><button className="btn" disabled={!dirty} onClick={save}>حفظ</button></div>
    </div>
  );
}

function Matches({ leadId }: { leadId: string }) {
  const [items, setItems] = useState<any[] | null>(null);
  useEffect(() => { api(`/api/leads/${leadId}/matches`).then((r) => setItems(r.items)).catch(() => setItems([])); }, [leadId]);
  return (
    <div className="card">
      <div className="section-title">وحدات مناسبة</div>
      {items === null ? <p className="muted small">جارٍ البحث…</p> : items.length === 0 ? (
        <p className="muted small">لا وحدات متاحة تطابق بياناته بعد. أكمل الميزانية والمنطقة ونوع العقار.</p>
      ) : (
        <div className="stack" style={{ gap: 8 }}>
          {items.map((m) => (
            <div key={m.unitId} className="timeline"><div className="item">
              <div className="spread"><strong>{m.projectName} · {m.unitNumber}</strong><span className="ltr small">{money(m.price)}</span></div>
              <div className="small muted">{m.reasons.join(" · ")}</div>
            </div></div>
          ))}
        </div>
      )}
    </div>
  );
}

function Notes({ lead, onAdded }: { lead: any; onAdded: () => void }) {
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  async function add() {
    setError("");
    try { await api(`/api/leads/${lead.id}/notes`, { method: "POST", body: JSON.stringify({ body }) }); setBody(""); onAdded(); }
    catch (e: any) { setError(e.message); }
  }
  return (
    <div className="card">
      <div className="section-title">الملاحظات</div>
      <div className="row" style={{ marginBottom: 10 }}>
        <input className="input" style={{ flex: 1 }} placeholder="اكتب ملاحظة عن العميل…" value={body}
          onChange={(e) => setBody(e.target.value)} onKeyDown={(e) => e.key === "Enter" && body.trim() && add()} />
        <button className="btn" disabled={!body.trim()} onClick={add}>إضافة</button>
      </div>
      <Notice kind="err">{error}</Notice>
      <div className="timeline">
        {lead.notes.length === 0 && <p className="muted small">لا ملاحظات بعد.</p>}
        {lead.notes.map((n: any) => (
          <div key={n.id} className="item">
            <div className="small" style={{ whiteSpace: "pre-wrap" }}>{n.body}</div>
            <div className="small muted">{n.authorName} · {dateTime(n.createdAt)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Tasks({ lead, onChanged }: { lead: any; onChanged: () => void }) {
  const [title, setTitle] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [error, setError] = useState("");
  async function add() {
    setError("");
    try {
      await api("/api/tasks", { method: "POST", body: JSON.stringify({ title, leadId: lead.id, ...(dueAt ? { dueAt } : {}) }) });
      setTitle(""); setDueAt(""); onChanged();
    } catch (e: any) { setError(e.message); }
  }
  async function toggle(t: any) {
    try { await api(`/api/tasks/${t.id}`, { method: "PATCH", body: JSON.stringify({ status: t.status === "DONE" ? "OPEN" : "DONE" }) }); onChanged(); }
    catch (e: any) { setError(e.message); }
  }
  return (
    <div className="card">
      <div className="section-title">المهام</div>
      <div className="row" style={{ marginBottom: 10 }}>
        <input className="input" style={{ flex: 1, minWidth: 160 }} placeholder="مثال: إرسال مخطط الشقة" value={title} onChange={(e) => setTitle(e.target.value)} />
        <input className="input" style={{ width: "auto" }} type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} aria-label="الموعد" />
        <button className="btn" disabled={title.trim().length < 2} onClick={add}>إضافة</button>
      </div>
      <Notice kind="err">{error}</Notice>
      {lead.tasks.length === 0 && <p className="muted small">لا مهام.</p>}
      {lead.tasks.map((t: any) => (
        <label key={t.id} className="row small" style={{ padding: "5px 0", borderBottom: "1px solid var(--line)" }}>
          <input type="checkbox" checked={t.status === "DONE"} onChange={() => toggle(t)} />
          <span style={{ textDecoration: t.status === "DONE" ? "line-through" : undefined, flex: 1 }}>{t.title}</span>
          {t.dueAt && <span className={t.status !== "DONE" && new Date(t.dueAt) < new Date() ? "error-text" : "muted"} style={{ marginTop: 0 }}>{dateTime(t.dueAt)}</span>}
        </label>
      ))}
    </div>
  );
}

function Appointments({ lead, onChanged }: { lead: any; onChanged: () => void }) {
  const [startsAt, setStartsAt] = useState("");
  const [location, setLocation] = useState("");
  const [error, setError] = useState("");
  async function add() {
    setError("");
    try {
      await api("/api/appointments", {
        method: "POST",
        body: JSON.stringify({ leadId: lead.id, startsAt, ...(location ? { location } : {}), ...(lead.interestedProjectId ? { projectId: lead.interestedProjectId } : {}) }),
      });
      setStartsAt(""); setLocation(""); onChanged();
    } catch (e: any) { setError(e.message); }
  }
  return (
    <div className="card">
      <div className="section-title">المواعيد</div>
      {lead.appointments.map((a: any) => (
        <div key={a.id} className="small" style={{ padding: "5px 0", borderBottom: "1px solid var(--line)" }}>
          {dateTime(a.startsAt)}{a.project ? ` · ${a.project.name}` : ""}{a.location ? ` · ${a.location}` : ""}
        </div>
      ))}
      <div className="stack" style={{ gap: 8, marginTop: 10 }}>
        <input className="input" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} aria-label="موعد الزيارة" />
        <input className="input" placeholder="المكان (اختياري)" value={location} onChange={(e) => setLocation(e.target.value)} />
        <button className="btn" disabled={!startsAt} onClick={add}>حجز زيارة</button>
      </div>
      <Notice kind="err">{error}</Notice>
      <p className="small muted" style={{ marginTop: 6 }}>حجز الزيارة يرفع درجة العميل تلقائياً.</p>
    </div>
  );
}

function ScoreHistory({ events }: { events: any[] }) {
  return (
    <div className="card">
      <div className="section-title">لماذا هذه الدرجة؟</div>
      {events.length === 0 ? <p className="muted small">لم تُسجَّل أحداث تقييم بعد.</p> : (
        <div className="timeline">
          {events.map((e) => (
            <div key={e.id} className="item spread small">
              <span>{e.reason}</span>
              <span className="row" style={{ gap: 8 }}>
                <strong className="ltr" style={{ color: e.points >= 0 ? "var(--accent)" : "var(--hot)" }}>{e.points > 0 ? `+${e.points}` : e.points}</strong>
                <span className="muted">← {e.scoreAfter}</span>
                <span className="muted">{dateTime(e.createdAt)}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
