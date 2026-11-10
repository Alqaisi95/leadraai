import {
  ArrowLeft,
  BarChart3,
  Bot,
  Building2,
  MessagesSquare,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { Logo } from "@/components/Logo";

export const metadata = {
  title: "ليدرا AI — ذكاء اصطناعي يحوّل محادثات Instagram إلى صفقات عقارية",
  description:
    "منصة عربية تستقبل رسائل عملائك على Instagram، ترد بذكاء، تؤهّل الجادين، وتسلّمهم لفريق مبيعاتك مع CRM عقاري متكامل.",
};

const FEATURES = [
  {
    icon: Bot,
    title: "رد ذكي على مدار الساعة",
    body: "يجيب عن أسئلة عملائك بلهجتهم فورًا — ولا يذكر سعرًا أو توفرًا إلا من مخزونك أنت، لا من اجتهاده.",
  },
  {
    icon: Sparkles,
    title: "تأهيل تلقائي بالنقاط",
    body: "كل إشارة اهتمام تُحتسب: الميزانية، المنطقة، مشاركة الرقم، طلب زيارة. تعرف من الجاد قبل أن تتصل.",
  },
  {
    icon: Users,
    title: "تسليم بشري ذكي",
    body: "عند الشكوى أو السؤال التعاقدي أو انخفاض الثقة، تنتقل المحادثة لموظفك فورًا مع ملخّص جاهز.",
  },
  {
    icon: Building2,
    title: "مخزون عقاري حي",
    body: "مشاريع ووحدات بأسعار وحالات محدّثة — مصدر واحد للحقيقة يقرأ منه المساعد ويطابق العملاء تلقائيًا.",
  },
  {
    icon: BarChart3,
    title: "تقارير تكشف الحقيقة",
    body: "قمع المبيعات، مخالفات SLA، تكلفة العميل لكل حملة، وأداء كل موظف — بلا جداول Excel.",
  },
  {
    icon: ShieldCheck,
    title: "عزل وأمان مؤسسي",
    body: "عزل كامل بين الشركات، تشفير رموز التكامل، صلاحيات بالأدوار، ومصادقة ثنائية وسجل تدقيق.",
  },
];

const STEPS = [
  { n: "١", title: "اربط Instagram", body: "ربط بنقرة عبر Meta — لا كود ولا إعدادات معقدة." },
  { n: "٢", title: "أدخل مشاريعك", body: "المشاريع والوحدات والأسعار، أو أضف دليلًا نصيًا للمساعد." },
  { n: "٣", title: "دع المساعد يعمل", body: "يرد، يؤهّل، يجدول الزيارات — وأنت تتابع من لوحة واحدة." },
];

export default function LandingPage() {
  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-30 border-b border-line bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <Logo />
          <div className="flex items-center gap-2.5">
            <a
              href="/login"
              className="rounded-field px-3.5 py-2 text-[13.5px] font-semibold text-dim hover:text-fg"
            >
              دخول
            </a>
            <a
              href="/signup"
              className="rounded-field bg-primary px-4 py-2 text-[13.5px] font-semibold text-primary-fg transition-colors hover:bg-primary-hover"
            >
              ابدأ مجانًا
            </a>
          </div>
        </div>
      </header>

      {/* hero */}
      <section className="relative overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0 opacity-60"
          style={{
            background:
              "radial-gradient(700px 420px at 80% -10%, rgba(15,118,110,0.16), transparent 65%), radial-gradient(520px 380px at 5% 100%, rgba(194,112,61,0.12), transparent 60%)",
          }}
        />
        <div className="relative mx-auto max-w-6xl px-5 py-20 text-center md:py-28">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-card px-3 py-1 text-[12px] font-semibold text-primary">
            <MessagesSquare size={12} /> مصمّم للسوق العقاري العربي
          </span>
          <h1 className="mx-auto mt-5 max-w-3xl text-[34px] font-bold leading-tight tracking-tight md:text-[46px]">
            عملاؤك يراسلونك الآن.
            <br />
            <span className="text-primary">من يرد عليهم؟</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-[15px] leading-relaxed text-dim md:text-[16.5px]">
            ليدرا يستقبل رسائل Instagram، يجيب بذكاء ودقة، يؤهّل العملاء الجادين، ويسلّمهم لفريق مبيعاتك مع كل
            ما يحتاجونه لإغلاق الصفقة — بالعربي، وبأسعارك أنت.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <a
              href="/signup"
              className="inline-flex items-center gap-2 rounded-field bg-primary px-6 py-3 text-[14.5px] font-bold text-primary-fg transition-colors hover:bg-primary-hover"
            >
              جرّب مجانًا ١٤ يومًا
              <ArrowLeft size={16} />
            </a>
            <a
              href="/login"
              className="inline-flex items-center gap-2 rounded-field border border-line bg-card px-6 py-3 text-[14.5px] font-bold transition-colors hover:border-primary hover:text-primary"
            >
              لدي حساب
            </a>
          </div>
          <p className="mt-3 text-[12px] text-dim">بلا بطاقة ائتمان · إعداد في دقائق</p>
        </div>
      </section>

      {/* features */}
      <section className="mx-auto max-w-6xl px-5 py-16">
        <h2 className="mb-2 text-center text-[26px] font-bold tracking-tight">
          كل ما تحتاجه لتحويل رسالة إلى صفقة
        </h2>
        <p className="mx-auto mb-10 max-w-2xl text-center text-[14px] text-dim">
          ليس روبوت محادثة — منصة مبيعات عقارية كاملة يقودها ذكاء اصطناعي مقيّد ببياناتك.
        </p>
        <div className="grid gap-4 md:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-card border border-line bg-card p-5 shadow-card">
              <span className="grid size-10 place-items-center rounded-lg bg-primary-soft text-primary">
                <f.icon size={18} />
              </span>
              <h3 className="mt-3.5 text-[15px] font-bold">{f.title}</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-dim">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* how */}
      <section className="border-y border-line bg-card/40">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <h2 className="mb-10 text-center text-[26px] font-bold tracking-tight">ثلاث خطوات وتبدأ</h2>
          <div className="grid gap-6 md:grid-cols-3">
            {STEPS.map((s) => (
              <div key={s.n} className="text-center">
                <div className="mx-auto grid size-12 place-items-center rounded-full bg-primary text-[18px] font-bold text-primary-fg">
                  {s.n}
                </div>
                <h3 className="mt-4 text-[15.5px] font-bold">{s.title}</h3>
                <p className="mx-auto mt-1.5 max-w-xs text-[13px] leading-relaxed text-dim">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* cta */}
      <section className="mx-auto max-w-6xl px-5 py-20 text-center">
        <h2 className="text-[28px] font-bold tracking-tight">كل رسالة بلا رد هي صفقة عند منافسك</h2>
        <p className="mx-auto mt-3 max-w-xl text-[14.5px] text-dim">
          ابدأ تجربتك المجانية اليوم — بياناتك تبقى ملكك، وتقدر تلغي في أي وقت.
        </p>
        <a
          href="/signup"
          className="mt-7 inline-flex items-center gap-2 rounded-field bg-primary px-7 py-3.5 text-[15px] font-bold text-primary-fg transition-colors hover:bg-primary-hover"
        >
          أنشئ حساب شركتك
          <ArrowLeft size={16} />
        </a>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-7 text-[12.5px] text-dim">
          <Logo />
          <div className="flex flex-wrap gap-4">
            <a href="/privacy" className="hover:text-fg">
              سياسة الخصوصية
            </a>
            <a href="/terms" className="hover:text-fg">
              شروط الاستخدام
            </a>
            <a href="/data-deletion" className="hover:text-fg">
              حذف البيانات
            </a>
          </div>
          <span>© {new Date().getFullYear()} Leadra AI — جميع الحقوق محفوظة</span>
        </div>
      </footer>
    </div>
  );
}
