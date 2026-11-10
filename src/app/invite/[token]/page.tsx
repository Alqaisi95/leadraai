"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Check, ShieldCheck } from "lucide-react";
import { Logo, LogoMark } from "@/components/Logo";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Input";
import { Skeleton } from "@/components/ui/Empty";

const ROLES: Record<string, string> = {
  ORG_ADMIN: "مدير المؤسسة",
  SALES_MANAGER: "مدير مبيعات",
  AGENT: "موظف مبيعات",
  MARKETING: "تسويق",
  VIEWER: "مشاهدة فقط",
};

export default function AcceptInvitePage() {
  const { token } = useParams<{ token: string }>();
  const [invite, setInvite] = useState<any>(null);
  const [dead, setDead] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch(`/api/invite/${token}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setInvite)
      .catch(() => setDead(true));
  }, [token]);

  const needsPassword = invite?.needsPassword ?? false;
  const valid = !needsPassword || (password.length >= 10 && password === confirm);

  async function accept() {
    if (!valid) return;
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`/api/invite/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(needsPassword ? { password } : {}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "تعذّر قبول الدعوة");
      if (data.organizationId) localStorage.setItem("leadra_org", data.organizationId);
      window.location.href = data.signedIn ? "/dashboard" : "/login";
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid min-h-dvh place-items-center bg-background p-6">
      <div className="w-full max-w-sm">
        <div className="mb-7">
          <LogoMark size={40} />
        </div>

        {dead && (
          <>
            <h1 className="text-xl font-bold">الدعوة غير صالحة</h1>
            <p className="mt-2 text-[13.5px] leading-relaxed text-dim">
              هذا الرابط منتهي الصلاحية أو استُخدم من قبل. اطلب من مدير مؤسستك إرسال دعوة جديدة.
            </p>
            <a href="/login" className="mt-5 inline-block">
              <Button variant="outline">الذهاب لتسجيل الدخول</Button>
            </a>
          </>
        )}

        {!invite && !dead && <Skeleton className="h-52" />}

        {invite && (
          <>
            <h1 className="text-xl font-bold">
              دُعيت للانضمام إلى <span className="text-primary">{invite.organizationName}</span>
            </h1>
            <div className="mt-4 grid gap-2 rounded-card border border-line bg-card px-4 py-3 text-[13px]">
              <div className="flex justify-between gap-3">
                <span className="text-dim">الاسم</span>
                <span className="font-semibold">{invite.fullName}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-dim">البريد</span>
                <span className="font-semibold" dir="ltr">
                  {invite.email}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-dim">الدور</span>
                <span className="font-semibold">{ROLES[invite.role] ?? invite.role}</span>
              </div>
            </div>

            {needsPassword ? (
              <div className="mt-5 grid gap-3.5">
                <Field label="كلمة المرور (١٠ أحرف على الأقل)">
                  <Input
                    type="password"
                    dir="ltr"
                    className="text-left"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </Field>
                <Field label="تأكيد كلمة المرور">
                  <Input
                    type="password"
                    dir="ltr"
                    className="text-left"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && accept()}
                  />
                </Field>
                {confirm.length > 0 && password !== confirm && (
                  <p className="-mt-1.5 text-[12px] text-danger">كلمتا المرور غير متطابقتين</p>
                )}
              </div>
            ) : (
              <p className="mt-4 flex items-center gap-2 text-[13px] text-dim">
                <ShieldCheck size={15} className="text-primary" />
                لديك حساب بالفعل — اقبل الدعوة ثم سجّل الدخول بكلمة مرورك الحالية.
              </p>
            )}

            <Button className="mt-5 h-10 w-full" loading={loading} disabled={!valid} onClick={accept}>
              <Check size={15} /> قبول الدعوة
            </Button>
            {error && <p className="mt-3 text-[13px] font-medium text-danger">{error}</p>}
          </>
        )}

        <div className="mt-10 flex justify-center opacity-50">
          <Logo />
        </div>
      </div>
    </div>
  );
}
