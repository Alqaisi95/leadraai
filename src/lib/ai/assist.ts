/**
 * Agent-facing AI helpers (§ suggest reply / handoff summary).
 * Unlike the auto-reply orchestrator these never send anything on their own —
 * output is a draft the human edits, so the price guard applies but no send path exists.
 */
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "../db";
import { searchKnowledge } from "./knowledge";
import { priceGuard } from "./safety";

const MODEL = "claude-opus-5";

/**
 * Carries a specific, actionable reason to the UI. Every provider failure mode
 * here is operational (no credit, bad key, rate limit) — surfacing them as a
 * generic 500 leaves the operator with nothing to act on.
 */
export class AiUnavailableError extends Error {
  constructor(
    readonly code:
      | "NO_KEY"
      | "NO_CREDIT"
      | "BAD_KEY"
      | "RATE_LIMITED"
      | "OVERLOADED"
      | "REFUSED"
      | "UNAVAILABLE" = "UNAVAILABLE",
    readonly arabic = "تعذّر توليد النص — حاول مجددًا",
  ) {
    super(code);
  }
}

function client() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new AiUnavailableError("NO_KEY", "الذكاء الاصطناعي غير مفعّل — أضف ANTHROPIC_API_KEY");
  }
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

/**
 * Map a provider failure to something an operator can act on.
 *
 * Keyed on the HTTP status rather than `instanceof`: the SDK's class names have
 * shifted between versions, and an `instanceof` check silently falls through
 * when the error crosses a module boundary with a duplicated dependency —
 * exactly the case where a wrong answer costs the most.
 */
export function toAiError(e: unknown): AiUnavailableError {
  if (e instanceof AiUnavailableError) return e;

  const status = typeof (e as any)?.status === "number" ? ((e as any).status as number) : null;
  const message = String((e as any)?.message ?? e ?? "");

  if (/credit balance/i.test(message)) {
    return new AiUnavailableError(
      "NO_CREDIT",
      "رصيد حساب Anthropic غير كافٍ — أضف رصيدًا من Plans & Billing",
    );
  }
  if (status === 401 || status === 403) {
    return new AiUnavailableError("BAD_KEY", "مفتاح Anthropic غير صالح — حدّثه في إعدادات النشر");
  }
  if (status === 429) {
    return new AiUnavailableError("RATE_LIMITED", "تجاوزت حد الطلبات على Anthropic — انتظر قليلًا");
  }
  if (status !== null && status >= 500) {
    return new AiUnavailableError("OVERLOADED", "خدمة Anthropic مشغولة حاليًا — أعد المحاولة بعد قليل");
  }
  if (e instanceof Anthropic.APIConnectionError) {
    return new AiUnavailableError("UNAVAILABLE", "تعذّر الاتصال بخدمة Anthropic");
  }
  return new AiUnavailableError();
}

async function conversationContext(conversationId: string, organizationId: string) {
  const conv = await prisma.conversation.findFirstOrThrow({
    where: { id: conversationId, organizationId },
    include: {
      organization: { select: { name: true } },
      lead: {
        select: {
          fullName: true,
          phone: true,
          purpose: true,
          city: true,
          area: true,
          budgetMin: true,
          budgetMax: true,
          buyTimeframe: true,
          score: true,
          temperature: true,
          interestedProjectId: true,
        },
      },
    },
  });

  const history = await prisma.message.findMany({
    where: { conversationId: conv.id },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { senderType: true, body: true, createdAt: true },
  });
  history.reverse();

  const lastCustomer = [...history].reverse().find((m) => m.senderType === "CUSTOMER")?.body ?? "";

  const units = await prisma.unit.findMany({
    where: {
      organizationId,
      status: "AVAILABLE",
      ...(conv.lead?.interestedProjectId ? { projectId: conv.lead.interestedProjectId } : {}),
    },
    include: { project: { select: { name: true } } },
    take: 10,
    orderBy: { updatedAt: "desc" },
  });

  const knowledge = await searchKnowledge(
    organizationId,
    lastCustomer,
    conv.lead?.interestedProjectId ?? null,
  );

  return { conv, history, units, knowledge };
}

function renderInventory(
  units: {
    unitNumber: string;
    unitType: string | null;
    bedrooms: number | null;
    areaSqm: any;
    price: any;
    project: { name: string };
  }[],
) {
  if (units.length === 0) return "(لا وحدات متاحة — لا تخترع وحدات أو أسعارًا)";
  return units
    .map(
      (u) =>
        `${u.project.name} — وحدة ${u.unitNumber}: ${u.unitType ?? ""} ${u.bedrooms ?? "؟"} غرف، ${u.areaSqm ?? "؟"} م²، السعر: ${u.price ?? "غير معلن"}`,
    )
    .join("\n");
}

function renderHistory(history: { senderType: string; body: string | null }[]) {
  return history
    .map(
      (m) =>
        `${m.senderType === "CUSTOMER" ? "العميل" : m.senderType === "AI" ? "المساعد الآلي" : "الموظف"}: ${m.body ?? ""}`,
    )
    .join("\n");
}

/** Draft a reply for the agent to review and edit — never sent automatically. */
export async function suggestReply(conversationId: string, organizationId: string, instruction?: string) {
  const { conv, history, units, knowledge } = await conversationContext(conversationId, organizationId);

  const system = `أنت مساعد لموظف مبيعات عقاري في شركة ${conv.organization.name}. مهمتك صياغة مسودة رد على رسالة العميل الأخيرة، سيراجعها الموظف قبل الإرسال.

قواعد صارمة:
1. لا تذكر سعرًا أو حالة توفر إلا إذا ورد حرفيًا في "بيانات المخزون" أدناه.
2. لا تقدم وعودًا تعاقدية (حجز، خصم، ضمان عائد).
3. اكتب بلهجة العميل ونبرته، ورسائل Instagram قصيرة — جملتان أو ثلاث.
4. أعد نص الرد فقط، بلا مقدمات ولا علامات اقتباس ولا شرح.`;

  const kb = knowledge.length
    ? knowledge.map((c, i) => `[مصدر ${i + 1}: ${c.sourceTitle}]\n${c.content}`).join("\n---\n")
    : "(لا مصادر معرفة مطابقة)";

  const lead = conv.lead;
  const leadCard = lead
    ? `الاسم: ${lead.fullName ?? "غير معروف"} · الغرض: ${lead.purpose} · المنطقة: ${[lead.city, lead.area].filter(Boolean).join(" ") || "غير محددة"} · الميزانية: ${lead.budgetMin ?? "؟"}–${lead.budgetMax ?? "؟"} · الدرجة: ${lead.score} (${lead.temperature})`
    : "(لا بيانات عميل بعد)";

  let res;
  try {
    res = await client().messages.create({
      model: MODEL,
      max_tokens: 1000,
      output_config: { effort: "low" },
      system,
      messages: [
        {
          role: "user",
          content: `## بيانات العميل\n${leadCard}\n\n## قاعدة المعرفة\n${kb}\n\n## بيانات المخزون (المصدر الوحيد للأسعار والتوفر)\n${renderInventory(units)}\n\n## المحادثة\n${renderHistory(history)}\n\n${instruction ? `## توجيه الموظف\n${instruction}\n\n` : ""}اكتب مسودة الرد الآن.`,
        },
      ],
    });
  } catch (e) {
    throw toAiError(e);
  }

  if (res.stop_reason === "refusal") {
    throw new AiUnavailableError("REFUSED", "تعذّر توليد رد لهذه المحادثة — اكتب الرد يدويًا");
  }

  const text = res.content
    .filter((b) => b.type === "text")
    .map((b: any) => b.text)
    .join("")
    .trim();
  const priceOk = priceGuard(
    text,
    units.map((u) => u.price?.toString() ?? null),
  );

  await prisma.aiRun.create({
    data: {
      organizationId,
      conversationId: conv.id,
      runType: "SUGGESTION",
      outputSummary: text.slice(0, 120),
      handedOff: false,
      error: priceOk ? null : "price_guard_warning",
    },
  });

  return { text, priceWarning: !priceOk };
}

/** Condense a long thread so an agent picking it up knows where things stand. */
export async function summarizeConversation(conversationId: string, organizationId: string) {
  const { conv, history } = await conversationContext(conversationId, organizationId);

  let res;
  try {
    res = await client().messages.create({
      model: MODEL,
      max_tokens: 900,
      output_config: { effort: "low" },
      system: `لخّص محادثة مبيعات عقارية لموظف يستلمها الآن. اكتب بالعربية بصيغة نقاط قصيرة تحت هذه العناوين بالضبط:
**من العميل:** (ما نعرفه عنه)
**ما يريده:** (النوع، المنطقة، الميزانية، التوقيت)
**ما اتُّفق عليه:** (وعود أو خطوات سابقة — أو "لا شيء")
**الخطوة التالية:** (أوضح إجراء مقترح للموظف)
لا تخترع معلومات غير موجودة في المحادثة؛ اكتب "غير معروف" عند النقص.`,
      messages: [{ role: "user", content: renderHistory(history) }],
    });
  } catch (e) {
    throw toAiError(e);
  }

  if (res.stop_reason === "refusal") {
    throw new AiUnavailableError("REFUSED", "تعذّر تلخيص هذه المحادثة");
  }

  const text = res.content
    .filter((b) => b.type === "text")
    .map((b: any) => b.text)
    .join("")
    .trim();

  await prisma.aiRun.create({
    data: {
      organizationId,
      conversationId: conv.id,
      runType: "SUMMARY",
      outputSummary: text.slice(0, 120),
      handedOff: false,
    },
  });

  return { text };
}
