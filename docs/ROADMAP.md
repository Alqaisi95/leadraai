# خارطة الطريق

> ✅ المراحل 1–5 منفذة بهذا المستودع. المتبقي: المرحلة 6 (الإطلاق) والبنود المعلمة أدناه كمستقبلية.

الأساس (المرحلة 1) موجود بهذا المستودع. التالي بالترتيب:

## المرحلة 2 — Meta وInbox (الأعلى مخاطرة، ابدأ بها مبكراً)
**لماذا الأعلى مخاطرة:** Meta App Review يستغرق أسابيع وقد يُرفض. أنشئ Meta App وقدّم للمراجعة قبل اكتمال بقية النظام.

1. Meta App + Business Verification (ابدأ اليوم — الأطول زمنياً)
2. OAuth flow → تخزين Token مشفر AES-256-GCM في `integration_tokens`
3. Webhook endpoint `/api/webhooks/meta`:
   - يتحقق من التوقيع → يخزن الحدث الخام في `webhook_events` → يرد 200 فوراً
   - **لا معالجة متزامنة أبداً** (متطلب §8)
4. Worker منفصل (BullMQ + Redis) يسحب من `webhook_events`:
   - Idempotency عبر `(provider, externalEventId)` unique — موجود بالـ Schema
   - Retry مع Exponential Backoff → Dead Letter بعد 5 محاولات
5. Inbox UI: قائمة محادثات + فلاتر الحالات السبع + إرسال رد
6. حارس التعارض: قفل المحادثة عند كتابة الموظف (منع رد AI والموظف معاً — §4.4)

**تقنياً:** أضف `worker/` كمجلد مستقل يشارك Prisma Client نفسه. Redis للـ Queue والـ Rate Limiting معاً.

## المرحلة 3 — CRM
- إنشاء Lead تلقائي من المحادثة + منع التكرار عبر `lead_identifiers`
- محرك Scoring: يقرأ `scoring_rules` ويكتب `lead_score_events` (القواعد بالـ Seed جاهزة)
- توزيع Round Robin مع حد أقصى لكل موظف
- Kanban للـ Pipeline مع فرض `entryRules` بالخادم قبل النقل
- Property Matching: فلترة `units` بالميزانية/المنطقة/النوع + سبب المطابقة

## المرحلة 4 — AI
- pgvector: `CREATE EXTENSION vector` + عمود embedding في `knowledge_documents` (migration يدوي)
- Pipeline: رسالة → Intent → Entity Extraction → RAG → Response
- قواعد الأمان **بالكود وليس بالـ Prompt فقط**:
  - الأسعار والتوفر تُحقن من `units` مباشرة، ويُمنع النموذج من توليدها
  - Confidence أقل من العتبة → `NEEDS_HUMAN` + إشعار
- كل استدعاء يُسجل في `ai_runs` مع نسخة الـ Prompt (`prompt_versions`)

## المرحلة 5 — التحليلات
- Materialized Views للتقارير الثقيلة (تحويل، SLA، حملات)
- تصدير CSV/XLSX + تقارير مجدولة بالبريد

## المرحلة 6 — الإطلاق
- اختبارات العزل بين الشركات (حرجة — أتمتها في CI)
- Load testing على Webhook path
- Backup/Restore drill فعلي
- Pilot مع شركة عقارية واحدة قبل الفتح العام

## ترتيب أولويات مقترح للأسابيع القادمة
| أسبوع | التركيز |
|---|---|
| 1 | تشغيل هذا الأساس + Meta App + Business Verification (قدّم فوراً) |
| 2–3 | OAuth + Webhooks + Worker + Inbox أولي |
| 4–5 | Leads + Scoring + Pipeline UI |
| 6–7 | AI (RAG + Handoff) على حساب تجريبي |
| 8 | Pilot داخلي + تقارير أساسية |
