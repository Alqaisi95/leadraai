# النشر على Cloudflare Workers — خطوة بخطوة

البنية: **Cloudflare Workers** (التطبيق عبر OpenNext + Cron Triggers لمعالجة الرسائل) + **PostgreSQL** الحالية (Neon أو غيرها) — لا تتغيّر القاعدة.

> الخطة المناسبة: **Workers Paid (5$ شهرياً)**. الخطة المجانية تحدّ وقت المعالج بـ 10ms لكل طلب وحجم الـ Worker بـ 3MB، ومحرّك Prisma مع ردود الـ AI يتجاوزهما غالباً.

---

## 1) أنشئ الـ Worker من GitHub

1. **dash.cloudflare.com** → Compute (Workers) → **Create** → **Import a repository**
2. اربط حساب GitHub واختر المستودع **`Alqaisi95/leadraai`**
3. إعدادات البناء:

| الحقل | القيمة |
|---|---|
| Project name | `leadra-ai` (يجب أن يطابق `name` في `wrangler.jsonc`) |
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
| `APP_URL` | `https://leadra-ai.<حسابك>.workers.dev` (أو نطاقك) |
| `RESEND_API_KEY` `EMAIL_FROM` | اختياري — للإيميلات (بدل SMTP) |

> انسخ القيم من Vercel → Project → Settings → Environment Variables.

ثم من **Deployments** أعد النشر (Retry) حتى تُقرأ المتغيرات.

## 3) Cron (معالجة الرسائل)

لا شيء تفعله — `wrangler.jsonc` يعرّف:
- `* * * * *` → `/api/worker/drain` (طابور الرسائل الواردة)
- `0 * * * *` → `/api/worker/jobs` (المهام المجدولة)

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

البناء على Cloudflare **لا** يشغّل الترحيلات. عند تغيير `schema.prisma` شغّلها من جهازك:
```bash
DATABASE_URL="..." npx prisma migrate deploy
```

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
