"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Check, ShieldAlert } from "lucide-react";
import { LogoMark } from "@/components/Logo";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Empty";

export default function VerifyEmailPage() {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<"working" | "done" | "dead">("working");

  useEffect(() => {
    // POST, not GET: mail clients and link scanners prefetch GET URLs, and a
    // scanner should not be able to consume the link before the person does.
    fetch(`/api/auth/verify/${token}`, { method: "POST" })
      .then((r) => setState(r.ok ? "done" : "dead"))
      .catch(() => setState("dead"));
  }, [token]);

  return (
    <div className="grid min-h-dvh place-items-center px-6 py-12">
      <div className="w-full max-w-sm">
        <LogoMark />

        {state === "working" && (
          <div className="mt-6 grid gap-3">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-16" />
          </div>
        )}

        {state === "done" && (
          <>
            <div className="mt-5 grid size-10 place-items-center rounded-field bg-primary-soft text-primary">
              <Check size={19} />
            </div>
            <h1 className="mt-4 text-xl font-bold">تم تأكيد بريدك</h1>
            <p className="mt-2 text-[13.5px] leading-relaxed text-dim">
              يمكنك الآن ربط حساب Instagram ودعوة أعضاء فريقك.
            </p>
            <Button onClick={() => (window.location.href = "/dashboard")} className="mt-5 h-10">
              إلى لوحة القيادة
            </Button>
          </>
        )}

        {state === "dead" && (
          <>
            <div className="mt-5 grid size-10 place-items-center rounded-field bg-danger/10 text-danger">
              <ShieldAlert size={19} />
            </div>
            <h1 className="mt-4 text-xl font-bold">هذا الرابط لم يعد صالحًا</h1>
            <p className="mt-2 text-[13.5px] leading-relaxed text-dim">
              روابط التأكيد تنتهي بعد ٤٨ ساعة. سجّل الدخول واطلب رابطًا جديدًا من الشريط أعلى الصفحة.
            </p>
            <Button onClick={() => (window.location.href = "/login")} className="mt-5 h-10">
              تسجيل الدخول
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
