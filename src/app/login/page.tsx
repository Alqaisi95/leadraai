"use client";
import { useState } from "react";
import { api } from "@/lib/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [needsMfa, setNeedsMfa] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit() {
    setError(""); setLoading(true);
    try {
      await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password, ...(totp ? { totp } : {}) }),
      });
      const me = await api("/api/me");
      const first = me.memberships?.[0];
      if (!first) { setError("لا توجد عضوية نشطة بأي شركة"); return; }
      localStorage.setItem("leadra_org", first.organizationId);
      window.location.href = "/dashboard";
    } catch (e: any) {
      if (e.code === "MFA_REQUIRED") { setNeedsMfa(true); setError("أدخل رمز تطبيق المصادقة"); }
      else if (e.code === "MFA_INVALID") setError("رمز MFA غير صحيح");
      else if (e.code === "LOCKED" || e.code === "RATE_LIMITED") setError("محاولات كثيرة — انتظر قليلاً");
      else setError("البريد أو كلمة المرور غير صحيحة");
    } finally { setLoading(false); }
  }

  return (
    <div className="login-wrap">
      <div className="login-box">
        <div className="logo" style={{ color: "var(--ink)", paddingBottom: 14 }}>ليدرا <em style={{ color: "var(--accent)" }}>AI</em></div>
        <p style={{ color: "var(--text-dim)", marginBottom: 20 }}>سجّل الدخول إلى منصتك</p>
        <div style={{ display: "grid", gap: 12 }}>
          <input className="input" type="email" placeholder="البريد الإلكتروني" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input className="input" type="password" placeholder="كلمة المرور" value={password} onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !needsMfa && submit()} />
          {needsMfa && (
            <input className="input" inputMode="numeric" placeholder="رمز MFA (6 أرقام)" value={totp}
              onChange={(e) => setTotp(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} autoFocus />
          )}
          <button className="btn" onClick={submit} disabled={loading}>{loading ? "جارٍ الدخول..." : "دخول"}</button>
        </div>
        {error && <p className="error-text">{error}</p>}
      </div>
    </div>
  );
}
