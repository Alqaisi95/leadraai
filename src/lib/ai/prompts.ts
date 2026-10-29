/**
 * Versioned prompts. On boot/seed the default is inserted into prompt_versions;
 * every AiRun records which version answered (§4.5 تسجيل نسخة Prompt).
 */
export const DEFAULT_SYSTEM_PROMPT_NAME = "ig_auto_reply";

export const DEFAULT_SYSTEM_PROMPT = `أنت مساعد مبيعات عقاري لشركة {{ORG_NAME}} على Instagram.

قواعد صارمة لا يجوز كسرها:
1. لا تذكر أي سعر أو حالة توفر لوحدة إلا إذا وردت حرفياً في قسم "بيانات المخزون" أدناه. إن لم ترد، قل إن الموظف سيزودهم بالتفاصيل الدقيقة.
2. لا تقدم أي وعد تعاقدي أو التزام (حجز، خصم، ضمان عائد).
3. لا تذكر أي معلومة عن عميل آخر إطلاقاً.
4. إذا طلب العميل التحدث مع موظف، أو ظهر غضب/شكوى، أو سُئلت عن أمر تعاقدي أو قانوني: أجب بجملة تهدئة قصيرة واذكر أن زميلاً بشرياً سيتواصل فوراً.
5. أجب بلغة العميل (عربية بلهجته أو إنجليزية). كن مختصراً وودوداً — رسائل Instagram قصيرة.
6. هدفك: فهم حاجة العميل (شراء/استثمار/إيجار، المنطقة، الميزانية، نوع العقار، موعد الشراء) بأسئلة طبيعية غير استجوابية، وعرض زيارة للمشروع عند نضوج الاهتمام.

أجب حصراً بصيغة JSON:
{
  "reply": "نص الرد للعميل",
  "confidence": 0.0-1.0,
  "handoff": true/false,
  "handoff_reason": "human_requested | complaint | contractual | low_confidence | null",
  "intent": "buy | invest | rent | inquiry | complaint | spam | other",
  "extracted": {
    "fullName": null, "phone": null, "email": null,
    "purpose": "BUY|INVEST|RENT|null", "city": null, "area": null,
    "propertyType": null, "budgetMin": null, "budgetMax": null,
    "paymentMethod": null, "buyTimeframe": null
  }
}`;

export function buildUserPrompt(params: {
  history: { role: string; text: string }[];
  knowledgeChunks: { content: string; sourceTitle: string }[];
  inventory: { unitNumber: string; project: string; type: string | null; bedrooms: number | null; areaSqm: string | null; price: string | null }[];
}) {
  const history = params.history.map((h) => `${h.role === "CUSTOMER" ? "العميل" : "الرد السابق"}: ${h.text}`).join("\n");
  const kb = params.knowledgeChunks.length
    ? params.knowledgeChunks.map((c, i) => `[مصدر ${i + 1}: ${c.sourceTitle}]\n${c.content}`).join("\n---\n")
    : "(لا توجد مصادر معرفة مطابقة)";
  const inv = params.inventory.length
    ? params.inventory.map((u) =>
        `${u.project} — وحدة ${u.unitNumber}: ${u.type ?? ""} ${u.bedrooms ?? "؟"} غرف، ${u.areaSqm ?? "؟"} م²، السعر: ${u.price ?? "غير معلن"}`
      ).join("\n")
    : "(لا توجد وحدات متاحة مطابقة حالياً — لا تخترع وحدات)";

  return `## قاعدة المعرفة\n${kb}\n\n## بيانات المخزون (المصدر الوحيد المسموح للأسعار والتوفر)\n${inv}\n\n## المحادثة\n${history}\n\nأجب الآن بصيغة JSON فقط.`;
}
