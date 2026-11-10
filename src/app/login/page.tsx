"use client";
import { useState } from "react";
import { ShieldCheck, MessagesSquare, TrendingUp } from "lucide-react";
import { Logo, LogoMark } from "@/components/Logo";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Input";
import { api } from "@/lib/client";

const FEATURES = [
  { icon: MessagesSquare, text: "ردود ذكية فورية على رسائل Instagram على مدار الساعة" },
  { icon: TrendingUp, text: "تأهيل تلقائي للعملاء وتمرير الجاهزين للبيع لفريقك" },
  { icon: ShieldCheck, text: "أسعار وتوفر من قاعدة بياناتك مباشرة — لا اجتهادات AI" },
];

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [needsMfa, setNeedsMfa] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit() {
    setError("");
    setLoading(true);
    try {
      await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password, ...(totp ? { totp } : {}) }),
      });
      const me = await api("/api/me");
      const first = me.memberships?.[0];
      if (!first) {
        setError("لا توجد عضوية نشطة بأي شركة");
        return;
      }
      localStorage.setItem("leadra_org", first.organizationId);
      window.location.href = "/dashboard";
    } catch (e: any) {
      if (e.code === "MFA_REQUIRED") {
        setNeedsMfa(true);
        setError("أدخل رمز تطبيق المصادقة");
      } else if (e.code === "MFA_INVALID") setError("رمز MFA غير صحيح");
      else if (e.code === "LOCKED" || e.code === "RATE_LIMITED") setError("محاولات كثيرة — انتظر قليلًا");
      else setError("البريد أو كلمة المرور غير صحيحة");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      {/* brand panel */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-night p-12 text-white lg:flex">
        <div
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            background:
              "radial-gradient(600px 400px at 85% -10%, rgba(77,179,168,0.35), transparent 65%), radial-gradient(500px 380px at 0% 110%, rgba(194,112,61,0.22), transparent 60%)",
          }}
        />
        <Logo light />
        <div className="relative">
          <h1 className="mb-3 text-[30px] font-bold leading-snug">
            محادثاتك العقارية،
            <br />
            تُدار وتتحوّل إلى <span className="text-[#4DB3A8]">صفقات</span>
          </h1>
          <p className="mb-8 max-w-md text-[14.5px] leading-relaxed text-white/60">
            ليدرا يستقبل رسائل عملائك، يجيب بذكاء، يؤهّل الجادين منهم، ويسلّمهم لفريق مبيعاتك مع كل التفاصيل.
          </p>
          <div className="grid max-w-md gap-3.5">
            {FEATURES.map((f, i) => (
              <div key={i} className="flex items-center gap-3 text-[13.5px] text-white/80">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-white/8">
                  <f.icon size={15} className="text-[#4DB3A8]" />
                </span>
                {f.text}
              </div>
            ))}
          </div>
        </div>
        <div className="relative text-[12px] text-white/40">© {new Date().getFullYear()} Leadra AI</div>
      </div>

      {/* form panel */}
      <div className="grid place-items-center bg-background p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Logo />
          </div>
          <div className="mb-1.5 hidden lg:block">
            <LogoMark size={40} />
          </div>
          <h2 className="mt-4 text-xl font-bold">أهلًا بعودتك</h2>
          <p className="mb-7 mt-1 text-[13px] text-dim">سجّل الدخول إلى منصتك</p>

          <div className="grid gap-3.5">
            <Field label="البريد الإلكتروني">
              <Input
                type="email"
                autoComplete="username"
                placeholder="you@company.com"
                dir="ltr"
                className="text-left"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <Field label="كلمة المرور">
              <Input
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
                dir="ltr"
                className="text-left"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !needsMfa && submit()}
              />
            </Field>
            {needsMfa && (
              <Input
                inputMode="numeric"
                aria-label="رمز المصادقة الثنائية"
                placeholder="رمز MFA (6 أرقام)"
                dir="ltr"
                className="text-left tracking-[0.3em]"
                value={totp}
                onChange={(e) => setTotp(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                autoFocus
              />
            )}
            <Button onClick={submit} loading={loading} className="mt-1 h-10">
              دخول
            </Button>
          </div>
          {error && <p className="mt-3 text-[13px] font-medium text-danger">{error}</p>}
          <a
            href="/forgot"
            className="mt-4 inline-block text-[13px] font-medium text-primary hover:underline"
          >
            نسيت كلمة المرور؟
          </a>
        </div>
      </div>
    </div>
  );
}
