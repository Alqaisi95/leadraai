# النشر على Cloudflare Workers — خطوة بخطوة

البنية: **Cloudflare Workers** (التطبيق عبر OpenNext + Cron Triggers لمعالجة الرسائل) + **PostgreSQL** الحالية (Neon أو غيرها) — لا تتغيّر القاعدة.

> الخطة المناسبة: **Workers Paid (5$ شهرياً)**. الخطة المجانية تحدّ وقت المعالج بـ 10ms لكل طلب وحجم الـ Worker بـ 3MB، ومحرّك Prisma مع ردود الـ AI يتجاوزهما غالباً.

---

## 0) أنشئ الطابور (مرة واحدة، قبل أول نشر)

**Storage & Databases → Queues → Create** باسم **`leadra-webhooks`** بالضبط.
بدونه يفشل النشر برسالة أن الطابور غير موجود. (الطوابير تتطلب خطة Workers Paid.)

## 1) أنشئ الـ Worker من GitHub

1. **dash.cloudflare.com** → Compute (Workers) → **Create** → **Import a repository**
2. اربط حساب GitHub واختر المستودع **`Alqaisi95/leadraai`**
3. إعدادات البناء:

| الحقل | القيمة |
|---|---|
| Project name | `leadraai` (يجب أن يطابق `name` في `wrangler.jsonc`) |
| Build command | `npx opennextjs-cloudflare build` |
| Deploy command | `npx wrangler deploy` |
| Root directory | `/` |

4. في **Build variables** أضف: `NODE_VERSION` = `22`

## 2) المتغيرات السرية

Worker → **Settings → Variables and Secrets** → أضف كل واحد كـ **Secret**:

| المتغير | القيمة |
|---|---|
| `DATABASE_URL` | رابط PostgreSQL الحالي (نفس قيمته في Vercel) |
| `TOKEN_ENCRYPTION_KEY` | **نفس القيمة الموجودة في Vercel** — إذا تغيّرت لن تُفك التوكنات المحفوظة |
| `CRON_SECRET` | نفس قيمة Vercel أو جديدة: `openssl rand -hex 24` |
| `ANTHROPIC_API_KEY` | مفتاح Anthropic |
| `META_APP_ID` `META_APP_SECRET` `META_WEBHOOK_VERIFY_TOKEN` | من Meta App |
| `APP_URL` | `https://leadraai.<حسابك>.workers.dev` (أو نطاقك) |
| `RESEND_API_KEY` `EMAIL_FROM` | اختياري — للإيميلات (بدل SMTP) |
| `AI_MODEL` | اختياري — اسم نموذج Claude (الافتراضي `claude-sonnet-4-6`). غيّره هنا لتجربة نموذج أحدث دون تعديل الكود |

> انسخ القيم من Vercel → Project → Settings → Environment Variables.

ثم من **Deployments** أعد النشر (Retry) حتى تُقرأ المتغيرات.

## 3) معالجة الرسائل (الطابور + Cron)

لا شيء تفعله بعد الخطوة 0:
- كل رسالة Instagram تُخزَّن ثم تُرسل إشارة إلى طابور `leadra-webhooks`، فتُعالَج خلال ثوانٍ
- `* * * * *` → `/api/worker/drain` شبكة أمان كل دقيقة لأي حدث فاتته الإشارة
- `0 * * * *` → `/api/worker/jobs` (المهام المجدولة)
- حدّ الطلبات (10 محاولات دخول/دقيقة، 120 طلباً/دقيقة لكل مستخدم) يعمل عبر Rate Limiting من Cloudflare تلقائياً

تراها في Worker → **Settings → Trigger Events**. اختبار يدوي:
```bash
curl https://<رابط-الـWorker>/api/worker/drain -H "Authorization: Bearer CRON_SECRET"
# {"processed":0,"failed":0,"dead":0}
```

## 4) حدّث روابط Meta

في Meta App (Leadra ai):
- Webhook URL: `https://<رابط-الـWorker>/api/webhooks/meta`
- OAuth Redirect URI: `https://<رابط-الـWorker>/api/integrations/meta/callback`

## 5) (اختياري) Hyperdrive لتسريع القاعدة

1. **Storage & Databases → Hyperdrive → Create** والصق رابط PostgreSQL
2. انسخ الـ ID وألغِ التعليق عن قسم `hyperdrive` في `wrangler.jsonc` ثم ادفع التعديل
3. الكود يستخدمه تلقائياً إن وُجد، وإلا يرجع لـ `DATABASE_URL`

## 6) الترحيلات (Migrations)

**مرة واحدة — الترحيل الأساسي:** القاعدة الحالية أُنشئت بلا ملفات ترحيل. من GitHub:
**Actions → Baseline migration → Run workflow** → يفتح PR فيه `prisma/migrations/0_init`. ادمجه، ثم من جهازك:
```bash
DATABASE_URL="رابط-الإنتاج" npx prisma migrate resolve --applied 0_init
```
هذا يسجّل أن الجداول موجودة أصلاً دون أن يلمس البيانات.

**بعدها:** البناء على Cloudflare **لا** يشغّل الترحيلات. عند تغيير `schema.prisma`:
```bash
npx prisma migrate dev --name وصف-التغيير          # محلياً
DATABASE_URL="رابط-الإنتاج" npx prisma migrate deploy  # على الإنتاج
```

## 7) المراقبة

- `GET /api/health` → `{"ok":true}` (200) أو 503 إذا القاعدة لا ترد — ضعه في أي خدمة مراقبة (UptimeRobot مثلاً) كل 5 دقائق
- مع `Authorization: Bearer CRON_SECRET` يعطي التفاصيل: عدد الأحداث المنتظرة والميتة، عمر أقدم حدث، آخر معالجة، النموذج المستخدم. يرجع 503 إذا علق حدث أكثر من 5 دقائق
- السجلات: Worker → **Logs** (Observability مفعّل في `wrangler.jsonc`)

---

## تطوير محلي

```bash
npm install
npm run dev        # Next.js العادي
cp .dev.vars.example .dev.vars && npm run preview   # بيئة Workers الحقيقية
```

## مشاكل شائعة

| العرض | الحل |
|---|---|
| `Worker exceeded CPU time limit` | رقِّ لخطة Workers Paid |
| `Your Worker exceeded the size limit of 3 MiB` | نفس الحل — حدّ الخطة المدفوعة 10MB |
| خطأ `No database configured` | `DATABASE_URL` غير مضاف كـ Secret، أو أضفته بعد النشر — أعد النشر |
| التكاملات تظهر "خطأ" بعد النقل | `TOKEN_ENCRYPTION_KEY` يختلف عن قيمة Vercel |
| الرسائل لا تُعالج | تحقّق من `CRON_SECRET` و Trigger Events، وراجع Logs في الـ Worker |
