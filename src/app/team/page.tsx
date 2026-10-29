"use client";
import { useCallback, useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { Modal, Field, Notice, ROLE_LABEL, MEMBER_STATUS_LABEL } from "@/components/ui";
import { api } from "@/lib/client";

const ROLES = Object.keys(ROLE_LABEL);

export default function TeamPage() {
  const [members, setMembers] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [adding, setAdding] = useState(false);
  const [secret, setSecret] = useState<null | { email: string; password: string }>(null);

  const load = useCallback(async () => setMembers((await api("/api/members")).items), []);
  useEffect(() => { load().catch((e) => setError(e.message)); }, [load]);

  async function patch(m: any, body: any, message: string) {
    setError(""); setMsg("");
    try {
      await api(`/api/members/${m.id}`, { method: "PATCH", body: JSON.stringify(body) });
      setMsg(message);
      await load();
    } catch (e: any) { setError(e.message); }
  }

  async function resetPassword(m: any) {
    if (!confirm(`إنشاء كلمة مرور مؤقتة جديدة لـ ${m.fullName}؟ سيُسجَّل خروجه من كل الأجهزة.`)) return;
    setError("");
    try {
      const r = await api(`/api/members/${m.id}/reset-password`, { method: "POST" });
      setSecret({ email: m.email, password: r.tempPassword });
    } catch (e: any) { setError(e.message); }
  }

  const active = members.filter((m) => m.status === "ACTIVE").length;

  return (
    <Shell>
      <div className="toolbar">
        <h1 className="page-title">الفريق</h1>
        <button className="btn" onClick={() => setAdding(true)}>إضافة عضو</button>
      </div>
      <p className="muted small" style={{ marginBottom: 14 }}>{active} عضواً نشطاً. العملاء الجدد يُوزَّعون تلقائياً على موظفي المبيعات النشطين.</p>
      <Notice kind="err">{error}</Notice>
      <Notice kind="ok">{msg}</Notice>

      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>الاسم</th><th>البريد</th><th>الدور</th><th>الحالة</th><th>العملاء</th><th>MFA</th><th></th></tr></thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id}>
                <td style={{ fontWeight: 600 }}>{m.fullName}{m.isMe && <span className="muted small"> (أنت)</span>}</td>
                <td className="ltr small">{m.email}</td>
                <td>
                  {m.isMe ? ROLE_LABEL[m.role] ?? m.role : (
                    <select className="input sm" style={{ width: "auto" }} value={m.role} aria-label={`دور ${m.fullName}`}
                      onChange={(e) => patch(m, { role: e.target.value }, `تغيّر دور ${m.fullName} إلى ${ROLE_LABEL[e.target.value]}`)}>
                      {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                    </select>
                  )}
                </td>
                <td><span className={`chip member-${m.status}`}>{MEMBER_STATUS_LABEL[m.status] ?? m.status}</span></td>
                <td>{m.leads}</td>
                <td className="small">{m.mfaEnabled ? "مفعّل" : <span className="muted">لا</span>}</td>
                <td>
                  {!m.isMe && (
                    <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                      {m.status === "ACTIVE"
                        ? <button className="btn sm plain" onClick={() => confirm(`إيقاف ${m.fullName}؟ لن يستطيع الدخول، ويبقى عملاؤه مسجّلين باسمه حتى تعيد توزيعهم.`) && patch(m, { status: "SUSPENDED" }, `أُوقف ${m.fullName}`)}>إيقاف</button>
                        : <button className="btn sm" onClick={() => patch(m, { status: "ACTIVE" }, `أُعيد تفعيل ${m.fullName}`)}>تفعيل</button>}
                      <button className="btn sm plain" onClick={() => resetPassword(m)}>كلمة مرور جديدة</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {adding && (
        <AddMemberModal onClose={() => setAdding(false)}
          onSaved={async (r, email) => {
            setAdding(false);
            if (r.tempPassword) setSecret({ email, password: r.tempPassword });
            else setMsg(`${email} لديه حساب سابق — أُضيف للشركة ويدخل بكلمة مروره الحالية`);
            await load();
          }} />
      )}

      {secret && (
        <Modal title="كلمة المرور المؤقتة" onClose={() => setSecret(null)}>
          <p className="small" style={{ marginBottom: 10 }}>
            أرسلها إلى صاحبها بطريقة آمنة. <strong>لن تظهر مرة أخرى.</strong> عليه تغييرها من الإعدادات بعد أول دخول.
          </p>
          <Field label="البريد"><div className="secret-box">{secret.email}</div></Field>
          <div style={{ height: 10 }} />
          <Field label="كلمة المرور"><div className="secret-box">{secret.password}</div></Field>
          <div className="form-actions">
            <button className="btn" onClick={() => navigator.clipboard?.writeText(`${secret.email}\n${secret.password}`)}>نسخ</button>
            <button className="btn plain" onClick={() => setSecret(null)}>تم</button>
          </div>
        </Modal>
      )}
    </Shell>
  );
}

function AddMemberModal({ onClose, onSaved }: { onClose: () => void; onSaved: (r: any, email: string) => void }) {
  const [f, setF] = useState({ fullName: "", email: "", phone: "", role: "AGENT" });
  const [error, setError] = useState("");
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });

  async function save() {
    setError("");
    try {
      const r = await api("/api/members", {
        method: "POST",
        body: JSON.stringify({ ...f, phone: f.phone || undefined }),
      });
      onSaved(r, f.email.trim().toLowerCase());
    } catch (e: any) { setError(e.message); }
  }

  return (
    <Modal title="إضافة عضو للفريق" onClose={onClose}>
      <div className="form-grid">
        <Field label="الاسم الكامل *"><input className="input" value={f.fullName} onChange={set("fullName")} /></Field>
        <Field label="البريد الإلكتروني *"><input className="input ltr" type="email" value={f.email} onChange={set("email")} /></Field>
        <Field label="الهاتف"><input className="input ltr" value={f.phone} onChange={set("phone")} /></Field>
        <Field label="الدور">
          <select className="input" value={f.role} onChange={set("role")}>
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
        </Field>
      </div>
      <p className="muted small" style={{ marginTop: 10 }}>تُنشأ كلمة مرور مؤقتة تظهر لك مرة واحدة لتسلّمها للعضو.</p>
      <Notice kind="err">{error}</Notice>
      <div className="form-actions">
        <button className="btn" disabled={f.fullName.trim().length < 2 || !f.email.includes("@")} onClick={save}>إضافة</button>
        <button className="btn plain" onClick={onClose}>إلغاء</button>
      </div>
    </Modal>
  );
}
