"use client";
import { useCallback, useEffect, useState } from "react";
import Shell, { can, useRole } from "@/components/Shell";
import { Field, Notice } from "@/components/ui";
import { api } from "@/lib/client";

const REQUIRABLE: Record<string, string> = {
  phone: "رقم الهاتف", fullName: "الاسم", email: "البريد", budgetMax: "الميزانية",
  area: "المنطقة", propertyType: "نوع العقار", interestedProjectId: "المشروع المهتم به",
};

type Tab = "account" | "org" | "scoring" | "pipeline";

export default function SettingsPage() {
  const role = useRole();
  const [tab, setTab] = useState<Tab>("account");
  const tabs: { key: Tab; label: string; show: boolean }[] = [
    { key: "account", label: "حسابي", show: true },
    { key: "org", label: "الشركة", show: can(role, "org.settings.manage") },
    { key: "scoring", label: "تقييم العملاء", show: can(role, "scoring.rules.manage") },
    { key: "pipeline", label: "مراحل المسار", show: can(role, "pipeline.manage") },
  ];

  return (
    <Shell>
      <h1 className="page-title">الإعدادات</h1>
      <div className="tabs">
        {tabs.filter((t) => t.show).map((t) => (
          <button key={t.key} className={`tab ${tab === t.key ? "active" : ""}`} onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </div>
      {tab === "account" && <AccountTab />}
      {tab === "org" && <OrgTab />}
      {tab === "scoring" && <ScoringTab />}
      {tab === "pipeline" && <PipelineTab />}
    </Shell>
  );
}

function AccountTab() {
  const [me, setMe] = useState<any>(null);
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [mfa, setMfa] = useState<null | { secret: string; otpauth: string }>(null);
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => setMe(await api("/api/me")), []);
  useEffect(() => { load().catch((e) => setError(e.message)); }, [load]);

  async function changePassword() {
    setError(""); setMsg("");
    if (pw.next !== pw.confirm) { setError("كلمتا المرور غير متطابقتين"); return; }
    try {
      await api("/api/me/password", { method: "POST", body: JSON.stringify({ current: pw.current, next: pw.next }) });
      setPw({ current: "", next: "", confirm: "" });
      setMsg("تم تغيير كلمة المرور، وسُجّل الخروج من الأجهزة الأخرى");
    } catch (e: any) { setError(e.message); }
  }

  async function startMfa() {
    setError("");
    try { setMfa(await api("/api/auth/mfa/setup", { method: "POST" })); } catch (e: any) { setError(e.message); }
  }
  async function verifyMfa() {
    setError("");
    try {
      await api("/api/auth/mfa/verify", { method: "POST", body: JSON.stringify({ code }) });
      setMfa(null); setCode(""); setMsg("فُعّلت المصادقة الثنائية"); await load();
    } catch { setError("الرمز غير صحيح — تأكد من وقت الهاتف وأعد المحاولة"); }
  }

  return (
    <div className="stack" style={{ maxWidth: 560 }}>
      <Notice kind="err">{error}</Notice>
      <Notice kind="ok">{msg}</Notice>
      {me && <div className="card"><dl className="kv"><dt>الاسم</dt><dd>{me.user.fullName}</dd><dt>البريد</dt><dd className="ltr">{me.user.email}</dd></dl></div>}

      <div className="card">
        <div className="section-title">تغيير كلمة المرور</div>
        <div className="stack">
          <Field label="الحالية"><input className="input" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
          <Field label="الجديدة (10 أحرف على الأقل)"><input className="input" type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field>
          <Field label="تأكيد الجديدة"><input className="input" type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} /></Field>
        </div>
        <div className="form-actions"><button className="btn" disabled={!pw.current || pw.next.length < 10} onClick={changePassword}>تغيير</button></div>
      </div>

      <div className="card">
        <div className="section-title">المصادقة الثنائية</div>
        {me?.user.mfaEnabled ? <p className="small">مفعّلة. يُطلب رمز من تطبيق المصادقة عند كل دخول.</p> : mfa ? (
          <div className="stack">
            <p className="small">افتح Google Authenticator أو Microsoft Authenticator، اختر «إدخال مفتاح يدوياً»، وأدخل:</p>
            <div className="secret-box">{mfa.secret}</div>
            <a className="small" href={mfa.otpauth} style={{ color: "var(--accent)" }}>أو افتح الرابط على هاتفك</a>
            <Field label="الرمز من التطبيق"><input className="input ltr" inputMode="numeric" maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} /></Field>
            <div className="form-actions"><button className="btn" disabled={code.length < 6} onClick={verifyMfa}>تأكيد وتفعيل</button></div>
          </div>
        ) : (
          <>
            <p className="small muted">طبقة حماية إضافية — ننصح بها لكل مدير.</p>
            <div className="form-actions"><button className="btn" onClick={startMfa}>تفعيل</button></div>
          </>
        )}
      </div>
    </div>
  );
}

function OrgTab() {
  const [org, setOrg] = useState<any>(null);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { api("/api/organization").then(setOrg).catch((e) => setError(e.message)); }, []);

  async function save() {
    setError(""); setMsg("");
    try {
      setOrg({ ...org, ...(await api("/api/organization", {
        method: "PATCH",
        body: JSON.stringify({ name: org.name, country: org.country || null, timezone: org.timezone, language: org.language }),
      })) });
      setMsg("تم الحفظ");
    } catch (e: any) { setError(e.message); }
  }

  if (!org) return <Notice kind="err">{error}</Notice>;
  const u = org.usage;
  return (
    <div className="stack" style={{ maxWidth: 640 }}>
      <Notice kind="err">{error}</Notice>
      <Notice kind="ok">{msg}</Notice>
      <div className="card">
        <div className="form-grid">
          <Field label="اسم الشركة (يظهر في ردود الذكاء الاصطناعي)"><input className="input" value={org.name} onChange={(e) => setOrg({ ...org, name: e.target.value })} /></Field>
          <Field label="الدولة"><input className="input" value={org.country ?? ""} onChange={(e) => setOrg({ ...org, country: e.target.value })} /></Field>
          <Field label="المنطقة الزمنية">
            <select className="input ltr" value={org.timezone} onChange={(e) => setOrg({ ...org, timezone: e.target.value })}>
              {["Asia/Baghdad", "Asia/Dubai", "Asia/Riyadh", "Asia/Kuwait", "Asia/Qatar", "Asia/Bahrain", "Asia/Muscat", "Asia/Amman", "Africa/Cairo", "Europe/Istanbul"].map((tz) => <option key={tz} value={tz}>{tz}</option>)}
            </select>
          </Field>
          <Field label="لغة الردود الافتراضية">
            <select className="input" value={org.language} onChange={(e) => setOrg({ ...org, language: e.target.value })}>
              <option value="AR">العربية</option><option value="EN">English</option>
            </select>
          </Field>
        </div>
        <div className="form-actions"><button className="btn" disabled={org.name.trim().length < 2} onClick={save}>حفظ</button></div>
      </div>
      {u && (
        <div className="card">
          <div className="section-title">الاستخدام هذا الشهر</div>
          <dl className="kv">
            <dt>الباقة</dt><dd>{u.plan === "none" ? "تجريبية" : u.plan}</dd>
            <dt>المحادثات</dt><dd>{u.conversations.used}{u.conversations.limit ? ` / ${u.conversations.limit}` : ""}</dd>
            <dt>ردود الذكاء الاصطناعي</dt><dd>{u.aiRuns.used}{u.aiRuns.limit ? ` / ${u.aiRuns.limit}` : ""}</dd>
          </dl>
        </div>
      )}
    </div>
  );
}

function ScoringTab() {
  const [rules, setRules] = useState<any[]>([]);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(async () => setRules((await api("/api/scoring-rules")).items), []);
  useEffect(() => { load().catch((e) => setError(e.message)); }, [load]);

  async function patch(id: string, body: any) {
    setError(""); setMsg("");
    try { await api(`/api/scoring-rules/${id}`, { method: "PATCH", body: JSON.stringify(body) }); setMsg("تم الحفظ — يُطبَّق على الأحداث القادمة"); await load(); }
    catch (e: any) { setError(e.message); }
  }

  return (
    <div className="stack" style={{ maxWidth: 760 }}>
      <p className="muted small">كل حدث يضيف نقاطاً أو يخصمها من درجة العميل (0–100). من 35 يصبح «دافئاً»، ومن 70 «جاهزاً للبيع» ويُنبَّه مدير المبيعات.</p>
      <Notice kind="err">{error}</Notice>
      <Notice kind="ok">{msg}</Notice>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>الحدث</th><th>المشروع</th><th>النقاط</th><th>مفعّل</th></tr></thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id}>
                <td>
                  <input className="input sm" defaultValue={r.label} aria-label="وصف القاعدة"
                    onBlur={(e) => e.target.value.trim() !== r.label && patch(r.id, { label: e.target.value })} />
                  <div className="small muted ltr" style={{ textAlign: "right" }}>{r.event}</div>
                </td>
                <td className="small">{r.project?.name ?? "كل المشاريع"}</td>
                <td>
                  <input className="input sm ltr" style={{ width: 80 }} type="number" min={-100} max={100} defaultValue={r.points} aria-label="النقاط"
                    onBlur={(e) => Number(e.target.value) !== r.points && patch(r.id, { points: Number(e.target.value) })} />
                </td>
                <td><input type="checkbox" checked={r.active} aria-label="مفعّل" onChange={(e) => patch(r.id, { active: e.target.checked })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PipelineTab() {
  const [pipelines, setPipelines] = useState<any[]>([]);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(async () => setPipelines((await api("/api/pipelines")).items), []);
  useEffect(() => { load().catch((e) => setError(e.message)); }, [load]);

  async function patch(id: string, body: any, message: string) {
    setError(""); setMsg("");
    try { await api(`/api/pipelines/stages/${id}`, { method: "PATCH", body: JSON.stringify(body) }); setMsg(message); await load(); }
    catch (e: any) { setError(e.message); }
  }

  return (
    <div className="stack" style={{ maxWidth: 820 }}>
      <p className="muted small">الشروط تُفرض في الخادم: لا تنتقل الفرصة لمرحلة قبل استكمال الحقول المطلوبة لها.</p>
      <Notice kind="err">{error}</Notice>
      <Notice kind="ok">{msg}</Notice>
      {pipelines.map((p) => (
        <div className="card" key={p.id}>
          <div className="section-title">{p.name}</div>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>#</th><th>المرحلة</th><th>مطلوب قبل الدخول</th></tr></thead>
              <tbody>
                {p.stages.map((s: any) => {
                  const requires: string[] = s.entryRules?.requires ?? [];
                  return (
                    <tr key={s.id}>
                      <td className="muted">{s.order}</td>
                      <td>
                        <input className="input sm" defaultValue={s.name} aria-label="اسم المرحلة"
                          onBlur={(e) => e.target.value.trim() !== s.name && patch(s.id, { name: e.target.value }, "تم تغيير اسم المرحلة")} />
                        {(s.isWon || s.isLost) && <span className="chip" style={{ marginTop: 4 }}>{s.isWon ? "مرحلة الفوز" : "مرحلة الخسارة — يُطلب السبب دائماً"}</span>}
                      </td>
                      <td>
                        <div className="row" style={{ gap: 6 }}>
                          {Object.entries(REQUIRABLE).map(([k, label]) => (
                            <label key={k} className="small row" style={{ gap: 4 }}>
                              <input type="checkbox" checked={requires.includes(k)}
                                onChange={(e) => patch(s.id, { requires: e.target.checked ? [...requires, k] : requires.filter((x) => x !== k) }, "تم تحديث شروط المرحلة")} />
                              {label}
                            </label>
                          ))}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
