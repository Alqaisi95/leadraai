import { CheckCircle2 } from "lucide-react";
import { LegalPage, Section, List } from "@/components/LegalPage";

export const metadata = {
  title: "حذف البيانات — ليدرا AI",
  description: "كيف تطلب حذف بياناتك من منصة ليدرا AI، وماذا يُحذف بالضبط.",
};

export default function DataDeletionPage({ searchParams }: { searchParams: { code?: string } }) {
  const code = searchParams?.code;

  return (
    <LegalPage title="حذف البيانات" updated="١ آب ٢٠٢٦">
      {code && (
        <div className="mb-8 flex items-start gap-3 rounded-card border border-line bg-primary-soft/50 px-4 py-3.5">
          <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-primary" />
          <div className="text-[13.5px] leading-relaxed">
            <b>تم تنفيذ طلب الحذف.</b>
            <div className="mt-1">
              رمز التأكيد:{" "}
              <code className="rounded bg-card px-1.5 py-0.5 font-mono" dir="ltr">
                {code}
              </code>
            </div>
            <p className="mt-1.5 text-dim">
              حُذفت محادثاتك وبياناتك المرتبطة بحساب Instagram المطلوب من قواعد بياناتنا. احتفظ بهذا الرمز
              مرجعًا لطلبك.
            </p>
          </div>
        </div>
      )}

      <Section title="ما الذي يُحذف">
        <p>عند تنفيذ طلب الحذف نمسح نهائيًا كل ما يخصّك:</p>
        <List
          items={[
            "كامل سجل المحادثة بينك وبين الشركة، بما فيه رسائلك والردود الآلية.",
            "ملف العميل المرتبط بك: الاسم، الهاتف، البريد، الميزانية، المنطقة، ونوع العقار.",
            "الملاحظات الداخلية والمهام والمواعيد المرتبطة بملفك.",
            "سجل النقاط والمعرّفات التي تربط حسابك بالمنصة.",
            "أي أحداث Webhook خام واردة من Instagram تخصّك.",
          ]}
        />
        <p>الحذف فوري ونهائي — لا نحتفظ بنسخة قابلة للاسترجاع بعد التنفيذ.</p>
      </Section>

      <Section title="الطريقة الأولى: من إعدادات Facebook">
        <p>
          إذا راسلت شركة عبر Instagram وتريد حذف بياناتك من منصتنا، افتح{" "}
          <span dir="ltr" className="font-medium">
            Settings → Apps and Websites
          </span>{" "}
          في حسابك على Facebook، ثم أزل تطبيق الشركة. سيُرسل Meta طلب الحذف إلينا تلقائيًا، وسنعرض لك رمز
          تأكيد على هذه الصفحة.
        </p>
      </Section>

      <Section title="الطريقة الثانية: طلب مباشر">
        <p>
          أرسل بريدًا إلى{" "}
          <span dir="ltr" className="font-medium">
            [privacy@example.com]
          </span>{" "}
          من البريد المرتبط بك، أو ذكر اسم مستخدمك على Instagram واسم الشركة التي راسلتها. ننفّذ الطلب خلال{" "}
          <b>٣٠ يومًا</b> ونرسل لك تأكيدًا.
        </p>
      </Section>

      <Section title="ملاحظة عن دور الشركة">
        <p>
          الشركة العقارية التي راسلتها هي المتحكّم ببياناتك، وليدرا AI تعالجها نيابة عنها. عند تنفيذ طلبك نحذف
          البيانات من أنظمتنا ونُبلغ الشركة. قد تحتفظ الشركة بسجلات لديها خارج المنصة (كدفتر مبيعات أو التزام
          قانوني) — لذلك يُنصح بمراسلتها مباشرة أيضًا.
        </p>
      </Section>

      <Section title="حسابات موظفي المنصة">
        <p>
          إن كنت موظفًا في شركة مشتركة وتريد حذف حسابك، فالطلب يمر عبر مدير مؤسستك من شاشة{" "}
          <span className="font-medium">الإعدادات ← الفريق</span>، أو راسلنا على البريد أعلاه.
        </p>
      </Section>
    </LegalPage>
  );
}
