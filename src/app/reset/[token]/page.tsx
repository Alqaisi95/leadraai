"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Check, ShieldAlert } from "lucide-react";
import { LogoMark } from "@/components/Logo";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Input";
import { Skeleton } from "@/components/ui/Empty";

export default function ResetPasswordPage() {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<"checking" | "ready" | "dead" | "done">("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Check the link before asking for a password. Discovering it expired only
  // after typing a new password twice is a pointless thing to put someone
  // through.
  useEffect(() => {
    fetch(`/api/auth/reset/${token}`)
      .then((r) => r.json())
      .then((d) => setState(d.valid ? "ready" : "dead"))
      .catch(() => setState("dead"));
  }, [token]);

  const valid = password.length >= 10 && password === confirm;

  async function submit() {
    if (!valid) return;
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`/api/auth/reset/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error?.message ?? "تعذّر إتمام العملية");
        return;
      }
      setState("done");
    } catch {
      setError("تعذّر الاتصال بالخادم");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid min-h-dvh place-items-center px-6 py-12">
      <div className="w-full max-w-sm">
        <LogoMark />

        {state === "checking" && (
          <div className="mt-6 grid gap-3">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-20" />
          </div>
        )}

        {state === "dead" && (
          <>
            <div className="mt-5 grid size-10 place-items-center rounded-field bg-danger/10 text-danger">
              <ShieldAlert size={19} />
            </div>
            <h1 className="mt-4 text-xl font-bold">هذا الرابط لم يعد صالحًا</h1>
            <p className="mt-2 text-[13.5px] leading-relaxed text-dim">
              روابط إعادة التعيين تنتهي بعد ساعة وتُستخدم مرة واحدة. اطلب رابطًا جديدًا وستصلك رسالة خلال
              دقائق.
            </p>
            <Button onClick={() => (window.location.href = "/forgot")} className="mt-5 h-10">
              اطلب رابطًا جديدًا
            </Button>
          </>
        )}

        {state === "done" && (
          <>
            <div className="mt-5 grid size-10 place-items-center rounded-field bg-primary-soft text-primary">
              <Check size={19} />
            </div>
            <h1 className="mt-4 text-xl font-bold">تم تغيير كلمة المرور</h1>
            <p className="mt-2 text-[13.5px] leading-relaxed text-dim">
              أُغلقت كل الجلسات المفتوحة على حسابك، على أي جهاز. سجّل الدخول بكلمة المرور الجديدة.
            </p>
            <Button onClick={() => (window.location.href = "/login")} className="mt-5 h-10">
              تسجيل الدخول
            </Button>
          </>
        )}

        {state === "ready" && (
          <>
            <h1 className="mt-5 text-xl font-bold">كلمة مرور جديدة</h1>
            <p className="mb-6 mt-1 text-[13px] text-dim">
              اختر كلمة مرور من ١٠ أحرف على الأقل. سيؤدي الحفظ إلى إغلاق كل جلساتك المفتوحة.
            </p>

            <div className="grid gap-3.5">
              <Field label="كلمة المرور الجديدة">
                <Input
                  type="password"
                  autoComplete="new-password"
                  placeholder="••••••••••"
                  dir="ltr"
                  className="text-left"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Field>
              <Field label="تأكيد كلمة المرور">
                <Input
                  type="password"
                  autoComplete="new-password"
                  placeholder="••••••••••"
                  dir="ltr"
                  className="text-left"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submit()}
                />
              </Field>

              {password.length > 0 && password.length < 10 && (
                <p className="text-[12.5px] text-dim">باقٍ {10 - password.length} أحرف على الأقل.</p>
              )}
              {confirm.length > 0 && password !== confirm && (
                <p className="text-[12.5px] text-danger">الكلمتان غير متطابقتين.</p>
              )}

              <Button onClick={submit} loading={loading} disabled={!valid} className="mt-1 h-10">
                حفظ كلمة المرور
              </Button>
            </div>

            {error && <p className="mt-3 text-[13px] font-medium text-danger">{error}</p>}
          </>
        )}
      </div>
    </div>
  );
}
