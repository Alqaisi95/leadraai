"use client";
import { useState } from "react";
import { MailCheck } from "lucide-react";
import { LogoMark } from "@/components/Logo";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Input";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function submit() {
    if (!email.includes("@")) return;
    setLoading(true);
    // The endpoint answers the same way whether or not the address is
    // registered, so there is nothing here to branch on — and nothing to show
    // that would leak the difference.
    await fetch("/api/auth/forgot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    }).catch(() => {});
    setLoading(false);
    setSent(true);
  }

  return (
    <div className="grid min-h-dvh place-items-center px-6 py-12">
      <div className="w-full max-w-sm">
        <LogoMark />

        {sent ? (
          <>
            <div className="mt-5 grid size-10 place-items-center rounded-field bg-primary-soft text-primary">
              <MailCheck size={19} />
            </div>
            <h1 className="mt-4 text-xl font-bold">تحقّق من بريدك</h1>
            <p className="mt-2 text-[13.5px] leading-relaxed text-dim">
              إن كان{" "}
              <span dir="ltr" className="font-medium text-fg">
                {email}
              </span>{" "}
              مسجّلًا لدينا، فقد أرسلنا إليه رابط إعادة التعيين. الرابط صالح لساعة واحدة ويُستخدم مرة واحدة.
            </p>
            <p className="mt-3 text-[12.5px] leading-relaxed text-dim">
              لم تصلك رسالة خلال دقائق؟ راجع مجلد البريد غير المرغوب، وتأكد من كتابة العنوان الصحيح — لا نكشف
              ما إذا كان بريد ما مسجّلًا أم لا.
            </p>
            <div className="mt-6 flex items-center gap-3">
              <Button onClick={() => setSent(false)} variant="outline" className="h-9.5">
                جرّب عنوانًا آخر
              </Button>
              <a href="/login" className="text-[13px] font-medium text-primary hover:underline">
                العودة لتسجيل الدخول
              </a>
            </div>
          </>
        ) : (
          <>
            <h1 className="mt-5 text-xl font-bold">نسيت كلمة المرور؟</h1>
            <p className="mb-6 mt-1 text-[13px] text-dim">
              اكتب بريدك وسنرسل لك رابطًا لتعيين كلمة مرور جديدة.
            </p>

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
                  onKeyDown={(e) => e.key === "Enter" && submit()}
                />
              </Field>
              <Button onClick={submit} loading={loading} className="mt-1 h-10">
                أرسل رابط إعادة التعيين
              </Button>
            </div>

            <a
              href="/login"
              className="mt-5 inline-block text-[13px] font-medium text-primary hover:underline"
            >
              تذكّرتها — العودة لتسجيل الدخول
            </a>
          </>
        )}
      </div>
    </div>
  );
}
