# النشر على Vercel — خطوة بخطوة (~15 دقيقة)

البنية: **Vercel** (التطبيق + معالجة الرسائل عبر Cron) + **Neon** (PostgreSQL مجاني).
لا تحتاج سيرفر منفصل للـ Worker — حولناه لمسار Serverless يُستدعى كل دقيقة.

---

## 1) ادفع الكود إلى GitHub

```bash
cd leadra-ai
git init && git add -A && git commit -m "Leadra AI v0.1"
# أنشئ مستودعاً خاصاً على github.com ثم:
git remote add origin https://github.com/USERNAME/leadra-ai.git
git push -u origin main
```

## 2) قاعدة البيانات — Neon (مجاني)

1. سجل في **neon.tech** → Create Project (اختر منطقة قريبة مثل Frankfurt)
2. انسخ **Connection String** (يبدأ بـ `postgresql://...`) — هذا هو `DATABASE_URL`

## 3) جهّز القيم السرية

```bash
# مفتاح تشفير الـ Tokens (32 بايت)
openssl rand -base64 32

# سر الـ Cron
openssl rand -hex 24
```

احتفظ بالناتجين. ومفتاح Anthropic من **console.anthropic.com** → API Keys.

## 4) الترحيل والبذر (مرة واحدة من جهازك)

```bash
# ضع رابط Neon في .env محلياً ثم:
npm install
npx prisma migrate dev --name init
npm run db:seed
```

> بعدها الترحيلات المستقبلية تصير تلقائياً — أمر البناء على Vercel يشغّل `prisma migrate deploy`.

## 5) Vercel

1. **vercel.com** → Add New → Project → استورد مستودع `leadra-ai`
2. قبل Deploy، أضف **Environment Variables**:

| المتغير | القيمة |
|---|---|
| `DATABASE_URL` | رابط Neon |
| `TOKEN_ENCRYPTION_KEY` | ناتج `openssl rand -base64 32` |
| `CRON_SECRET` | ناتج `openssl rand -hex 24` |
| `ANTHROPIC_API_KEY` | من console.anthropic.com |
| `APP_URL` | `https://اسم-مشروعك.vercel.app` (حدّثه بعد أول نشر إذا اختلف) |
| `META_APP_ID` `META_APP_SECRET` `META_WEBHOOK_VERIFY_TOKEN` | من Meta App (اترك فارغة الآن إذا لم تنشئه بعد — المنصة تشتغل بالبيانات التجريبية) |

3. اضغط **Deploy**

## 6) تشغيل معالجة الرسائل (المهم)

`vercel.json` يعرّف Cron كل دقيقة على `/api/worker/drain`.

⚠️ **خطة Vercel المجانية (Hobby) تحدد الـ Cron بمرة واحدة يومياً.** خياراك:
- **Vercel Pro** ($20/شهر): الـ Cron كل دقيقة يشتغل مباشرة، لا شيء إضافي
- **مجاناً**: سجل في **cron-job.org** وأنشئ مهمة كل دقيقة تستدعي:
  `https://اسم-مشروعك.vercel.app/api/worker/drain`
  مع Header: `Authorization: Bearer قيمة-CRON_SECRET`

اختبر يدوياً:
```bash
curl https://اسم-مشروعك.vercel.app/api/worker/drain -H "Authorization: Bearer CRON_SECRET"
# المفروض يرجع {"processed":0,"failed":0,"dead":0}
```

## 7) افتح المنصة

`https://اسم-مشروعك.vercel.app` → دخول بـ `admin@demo.leadra.ai` / `Leadra@2026!`
كل شيء (Inbox، المسار، التقارير) يشتغل فوراً بالبيانات التجريبية.

## 8) ربط Meta (عندما يجهز الـ App)

- Webhook URL في إعدادات Meta App: `https://اسم-مشروعك.vercel.app/api/webhooks/meta`
- Verify Token: نفس قيمة `META_WEBHOOK_VERIFY_TOKEN`
- OAuth Redirect URI: `https://اسم-مشروعك.vercel.app/api/integrations/meta/callback`

---

## مشاكل شائعة

| العرض | الحل |
|---|---|
| Build يفشل عند Prisma | تأكد `DATABASE_URL` مضاف بمتغيرات Vercel لكل البيئات (Production + Preview) |
| دخول ناجح ثم صفحة فارغة | حدّث `APP_URL` ليطابق الرابط الفعلي وأعد النشر |
| الرسائل لا تُعالج | الـ Cron ما يشتغل — راجع الخطوة 6 واختبر بـ curl |
| ردود AI لا تظهر | تحقق من رصيد `ANTHROPIC_API_KEY` وراجع Logs بـ Vercel → Functions |
