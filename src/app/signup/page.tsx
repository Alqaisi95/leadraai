"use client";
import { useState } from "react";
import { Check } from "lucide-react";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Input";
import { api } from "@/lib/client";

const PERKS = [
  "١٤ يومًا مجانًا — بلا بطاقة ائتمان",
  "مسار مبيعات وقواعد تنقيط جاهزة من أول دقيقة",
  "حتى ٥ مستخدمين و٥٠٠ محادثة في التجربة",
];

export default function SignupPage() {
  const [form, setForm] = useState({ organizationName: "", fullName: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const valid =
    form.organizationName.trim().length >= 2 &&
    form.fullName.trim().length >= 2 &&
    /\S+@\S+\.\S+/.test(form.email) &&
    form.password.length >= 10;

  async function submit() {
    if (!valid) return;
    setError("");
    setLoading(true);
    try {
      await api("/api/auth/signup", { method: "POST", body: JSON.stringify(form) });
      const me = await api("/api/me");
      const first = me.memberships?.[0];
      if (first) localStorage.setItem("leadra_org", first.organizationId);
      window.location.href = "/dashboard";
    } catch (e: any) {
      if (e.code === "EMAIL_TAKEN") setError("هذا البريد مسجل بالفعل — سجّل الدخول بدلًا من ذلك.");
      else if (e.code === "RATE_LIMITED") setError("محاولات كثيرة — انتظر قليلًا.");
      else setError("تحقق من البيانات — كلمة المرور ١٠ أحرف على الأقل.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-night p-12 text-white lg:flex">
        <div
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            background:
              "radial-gradient(600px 400px at 85% -10%, rgba(77,179,168,0.35), transparent 65%), radial-gradient(500px 380px at 0% 110%, rgba(194,112,61,0.22), transparent 60%)",
          }}
        />
        <a href="/" className="relative">
          <Logo light />
        </a>
        <div className="relative">
          <h1 className="mb-4 text-[30px] font-bold leading-snug">
            ابدأ خلال
            <br />
            <span className="text-[#4DB3A8]">دقيقتين</span>
          </h1>
          <div className="grid max-w-md gap-3">
            {PERKS.map((p) => (
              <div key={p} className="flex items-center gap-3 text-[13.5px] text-white/80">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[#4DB3A8]/15">
                  <Check size={13} className="text-[#4DB3A8]" />
                </span>
                {p}
              </div>
            ))}
          </div>
        </div>
        <div className="relative text-[12px] text-white/40">© {new Date().getFullYear()} Leadra AI</div>
      </div>

      <div className="grid place-items-center bg-background p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <a href="/">
              <Logo />
            </a>
          </div>
          <h2 className="text-xl font-bold">أنشئ حساب شركتك</h2>
          <p className="mb-7 mt-1 text-[13px] text-dim">
            لديك حساب؟{" "}
            <a href="/login" className="font-semibold text-primary hover:underline">
              سجّل الدخول
            </a>
          </p>

          <div className="grid gap-3.5">
            <Field label="اسم الشركة">
              <Input
                value={form.organizationName}
                onChange={(e) => setForm({ ...form, organizationName: e.target.value })}
                placeholder="شركة الديار العقارية"
                autoFocus
              />
            </Field>
            <Field label="اسمك">
              <Input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
            </Field>
            <Field label="البريد الإلكتروني">
              <Input
                type="email"
                dir="ltr"
                className="text-left"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </Field>
            <Field label="كلمة المرور (١٠ أحرف على الأقل)">
              <Input
                type="password"
                dir="ltr"
                className="text-left"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && submit()}
              />
            </Field>
            <Button className="mt-1 h-10" loading={loading} disabled={!valid} onClick={submit}>
              إنشاء الحساب
            </Button>
          </div>
          {error && <p className="mt-3 text-[13px] font-medium text-danger">{error}</p>}
        </div>
      </div>
    </div>
  );
}
