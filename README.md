# Leadra AI

منصة SaaS متعددة الشركات تربط حسابات Instagram المهنية بمساعد ذكاء اصطناعي وCRM عقاري. الواجهة عربية RTL.

```
رسالة Instagram → Webhook → طابور → عميل (Lead) → تنقيط → رد آلي بالعربية
                                  → صندوق محادثات للموظفين → مسار بيع → مطابقة بالوحدات
```

**المكدّس:** Next.js 16 (App Router) · TypeScript · Prisma 5 + PostgreSQL (Neon) · Tailwind v4 · Anthropic SDK · Vitest + Playwright · Cloudflare Workers عبر OpenNext (و Vercel).

> ⚠️ نسخة Next هذه تختلف عمّا تعرفه — اقرأ `AGENTS.md` والأدلة في `node_modules/next/dist/docs/` قبل كتابة كود.

**التحقق:** كل دفعة تمرّ بثلاث مهام في CI — `test` (typecheck، lint، اختبارات الوحدة والعزل على Postgres، البناء)، `e2e` (Playwright)، و`workers` (بناء الـ Worker وتشغيل طلبات حقيقية في `workerd`). لا رقم اختبارات مكتوب هنا عمدًا: الأرقام المكتوبة تتقادم — شغّل `npm test`.

**ما لا يعمل بعد، ولأسباب خارج الكود:** رصيد Anthropic، ربط حساب Instagram حقيقي، Meta App Review، وبوابة الدفع. التفاصيل في `docs/META-APP-REVIEW.md` و`CLOUDFLARE.md`.

---

## القرارات المعمارية (ولماذا)

| القرار                                                           | البديل المرفوض               | السبب                                                                                                                 |
| ---------------------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Monolith أولاً** بطبقات نظيفة (`src/lib` كطبقة Domain)         | Microservices من اليوم الأول | 16 خدمة منفصلة لفريق صغير = انتحار تشغيلي. الطبقات النظيفة تسمح بفصل الـ Workers لاحقاً دون إعادة كتابة               |
| **Next.js + TypeScript**                                         | Laravel / Django             | لغة واحدة للواجهة والخادم، أسهل توظيف بالمنطقة، ودعم RTL ممتاز                                                        |
| **PostgreSQL + Prisma**                                          | MongoDB                      | البيانات علائقية بامتياز (40+ جدول مترابط)، وpgvector يغطي RAG بالمرحلة الرابعة دون قاعدة Vector منفصلة               |
| **عزل Tenant على مستوى الصف** (`organizationId` بكل جدول تشغيلي) | Schema لكل شركة              | أبسط تشغيلياً حتى مئات الشركات؛ الحارس في `src/lib/tenant.ts` يعيد **404 وليس 403** كي لا يُكشف وجود سجلات شركات أخرى |
| **Session tokens مُعمّاة (hashed opaque)**                       | JWT stateless                | تتيح "إلغاء جميع الجلسات عند الاشتباه" فوراً (متطلب §4.2) — JWT لا يُلغى قبل انتهائه                                  |
| **RBAC في الخادم فقط** (`src/lib/rbac.ts`)                       | فحص بالواجهة                 | متطلب صريح §4.2؛ الواجهة تخفي الأزرار، الخادم يقرر                                                                    |

## القاعدة الذهبية للمخزون

`units.status` هو **المصدر الوحيد المعتمد** لحالة الوحدة. الـ AI بالمرحلة الرابعة يقرأ التوفر من هذا الحقل فقط — أبداً من مستندات قاعدة المعرفة. كل تغيير يُسجّل في `unit_availability_history` + `audit_logs` (انظر `src/app/api/units/[id]/status/route.ts`).

---

## التشغيل

```bash
# 1. PostgreSQL محلي (Docker)
docker run -d --name leadra-pg -e POSTGRES_USER=leadra -e POSTGRES_PASSWORD=leadra -e POSTGRES_DB=leadra -p 5432:5432 postgres:16

# 2. الإعداد
cp .env.example .env        # عدّل DATABASE_URL إذا لزم
npm install
npx prisma migrate deploy
npm run db:seed             # شركة تجريبية + Pipeline + مشروع + وحدات + قواعد Scoring

# 3. التشغيل
npm run dev
```

حسابات التجربة بعد الـ Seed (كلمة المرور: `Leadra@2026!`):
`admin@demo.leadra.ai` (مدير الشركة) · `manager@` (مدير مبيعات) · `agent1@` / `agent2@` (موظفون) · `marketing@`

### تجربة API سريعة

```bash
# تسجيل الدخول
curl -X POST localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@demo.leadra.ai","password":"Leadra@2026!"}'

# جلب المشاريع (استبدل TOKEN وORG_ID)
curl localhost:3000/api/projects \
  -H 'Authorization: Bearer TOKEN' \
  -H 'X-Organization-Id: ORG_ID'
```

كل طلب يتطلب Header باسم `X-Organization-Id` — المستخدم الواحد قد يكون عضواً بأكثر من شركة، والسياق يُحل بالخادم عبر `resolveContext()`.

---

## بنية المشروع

```
prisma/schema.prisma        نموذج البيانات الكامل
prisma/migrations/          بعضها مكتوب يدويًا — استخدم `migrate deploy` لا `migrate dev`
worker/index.ts             Worker مستقل يستهلك الطابور (للاستضافة طويلة التشغيل)
cloudflare-worker.ts        مدخل الـ Worker على Cloudflare (يضيف معالج الـ cron)
src/lib/                    طبقة الـ Domain — المنطق كله هنا
  auth · rbac · tenant · audit · api      الأمان والعزل والصلاحيات
  queue · jobs · background               الطابور، الوظائف المجدولة، العمل بعد الرد
  ai/                                     الـ Orchestrator وحارس الأسعار
  db · email                              عميل Prisma والبريد لكل بيئة تشغيل
src/app/api/                مسارات الـ API
src/app/<page>/             الصفحات
tests/ · e2e/               اختبارات الوحدة والعزل · Playwright
scripts/create-user.ts      إنشاء حساب جاهز (مع اشتراك) بأمر واحد
CLOUDFLARE.md               النشر على Workers والتحويل من Vercel
```

## ما المُنجز مقابل وثيقة المتطلبات

**المرحلة 1 — الأساس** ✅

- §4.1–4.2 مؤسسات، أعضاء، فرق، أدوار، دخول آمن (قفل 5 محاولات/15د، جلسات قابلة للإلغاء)، RBAC خادمي، عزل كامل بين الشركات، Audit append-only مع Redaction

**المرحلة 2 — Meta وInbox** ✅

- §4.3 OAuth رسمي، تشفير Tokens بـ AES-256-GCM (لا تصل للواجهة أبداً)، Webhook Gateway يتحقق من التوقيع ويخزن الخام ويرد فوراً
- Worker مستقل (`worker/index.ts`): Queue بقاعدة البيانات مع `FOR UPDATE SKIP LOCKED` (توسع أفقي آمن)، Idempotency، Retry بـ Exponential Backoff، Dead Letter بعد 5 محاولات + إشعار
- §4.4 Inbox كامل: الحالات السبع بآلة حالات مفروضة، فلترة، بحث، وحارس التصادم (رد الموظف يوقف AI فوراً)

**المرحلة 3 — CRM** ✅

- §4.6 إنشاء Lead تلقائي + منع تكرار عبر المعرفات (دمج يدوي فقط)
- §4.7 محرك Scoring بقواعد قابلة للتعديل لكل شركة/مشروع + سجل كامل + إشعار عند بلوغ 70
- §4.8 Pipeline بقواعد انتقال إلزامية بالخادم، توزيع Round Robin بحد أقصى، إعادة توزيع عند الغياب
- §4.10 مطابقة العميل بالوحدات مع أسباب مشروحة — من `units.status` حصراً
- §4.11 مهام ومواعيد (الموعد يرفع الدرجة تلقائياً)

**المرحلة 4 — AI** ✅

- §4.5 Orchestrator كامل: RAG من قاعدة المعرفة + حقن المخزون الحي، استخراج الكيانات → تحديث Lead → Scoring
- **قواعد أمان بالكود لا بالـ Prompt فقط**: حارس الأسعار (أي رقم سعري بالرد لازم يطابق المخزون المحقون حرفياً وإلا يُحظر)، عتبة ثقة 0.65، تسليم بشري عند الشكوى/الطلب/الغموض
- Prompt Versioning: كل AiRun يسجل نسخة الـ Prompt والثقة والزمن والتكلفة

**المرحلة 5 — التقارير** ✅

- §4.13 تقارير الإدارة (تحويل، Pipeline، مصادر، Cost per Lead) والفريق (أول رد، SLA، عملاء راكدون) وAI (نسبة المعالجة، التسليم، الثقة، التكلفة)

**الواجهة** ✅ — عربية RTL: دخول، لوحة قيادة، Inbox بمحادثات حية، Kanban للمسار

**المتبقي للمرحلة 6 (الإطلاق)** — انظر docs/ROADMAP.md:

- Meta App Review وBusiness Verification (الأطول زمنيًا)
- بوابة دفع أمام `POST /api/billing/plan`
- Load testing على مسار الويبهوك، Backup/Restore drill، وPilot مع شركة واحدة
