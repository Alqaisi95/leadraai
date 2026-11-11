# النشر على Cloudflare Workers

**النشر تلقائي.** المستودع مربوط بـ Workers Builds: كل دفعة إلى `main` تُبنى
وتُنشَر على الـ Worker `leadraai`. والكود مُتحقَّق منه على هذه البيئة: مهمة
`workers` في GitHub Actions تبني الـ Worker وتخدم طلبات حقيقية من `workerd` على
Postgres (صحة ×٣، تسجيل دخول، cron) في كل دفعة.

> Workers Builds ينشر فور انتهاء بنائه ولا ينتظر نتيجة GitHub Actions. لا تدمج
> في `main` إلا PR اختباراته خضراء.

## ١. متغيرات البناء (Worker → Settings → Build → Build variables and secrets)

| المتغير                        | القيمة                                | لماذا                                                                                                                              |
| ------------------------------ | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `DIRECT_URL`                   | رابط Neon **المباشر** (بلا `-pooler`) | تُطبَّق به الترحيلات قبل كل بناء إنتاجي (`scripts/migrate-on-deploy.mjs`). **بدونه يتوقف البناء عمدًا** وتبقى النسخة السابقة تعمل. |
| `NODE_VERSION`                 | `22`                                  | Wrangler يتطلبه                                                                                                                    |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | اختياري                               | إشعارات المتصفح؛ يُحقن وقت البناء                                                                                                  |

أمر البناء: `npx opennextjs-cloudflare build` · أمر النشر: `npx wrangler deploy`.

## ٢. أسرار الـ Worker (مرة واحدة)

`DATABASE_URL` وبقية الأسرار تُضبط على الـ Worker نفسه وتبقى عبر النشرات
(`keep_vars`):

```bash
for k in DATABASE_URL TOKEN_ENCRYPTION_KEY CRON_SECRET ANTHROPIC_API_KEY \
         META_APP_ID META_APP_SECRET META_WEBHOOK_VERIFY_TOKEN \
         VAPID_PRIVATE_KEY VAPID_SUBJECT SENTRY_DSN; do
  npx wrangler secret put "$k"
done
```

`TOKEN_ENCRYPTION_KEY` يجب أن يكون **نفس** قيمة Vercel، وإلا لن تُفك رموز
Instagram المخزّنة. أسرار SMTP لا لزوم لها هنا (انظر «البريد»).

## ٣. الخطة

**Workers Paid** مطلوبة: تسجيل الدخول يشغّل bcrypt والـ AI يحتاج ثوانيَ، وكلاهما
يتجاوز حد الـ 10ms للخطة المجانية.

## ما يختلف عن Vercel

- **الرسائل تُعالَج فور وصولها** (الويبهوك يبدأ المعالجة بعد الرد على Meta)،
  والـ cron كل دقيقة شبكة أمان. على Vercel المجاني كان الـ cron يوميًا.
- **قاعدة البيانات:** الـ Worker يتصل بـ `DATABASE_URL` مباشرة عبر `pg`.
  **Hyperdrive اختياري** لتجميع الاتصالات: أنشئه موجّهًا إلى نقطة Neon المباشرة
  (`npx wrangler hyperdrive create leadra-db --connection-string="$DIRECT_URL"`)
  ثم فعّل قسم `hyperdrive` في `wrangler.jsonc` بالمعرّف. الكود يستخدمه تلقائيًا
  إن وُجد.
- **البريد:** SMTP لا يعمل على Workers. الإرسال يمرّ عبر ربط `EMAIL` (خدمة بريد
  Cloudflare) ويحتاج تفعيل نطاق الإرسال مرة واحدة:
  `npx wrangler email sending enable <domain>`. قبل ذلك تُعيد دوال البريد `false`
  والإشعارات داخل التطبيق تعمل — لكن إعادة كلمة المرور والدعوات وتحقق البريد
  والتقارير المجدولة لن ترسل شيئًا.
- **`exceljs`** غير مجرَّب على Workers؛ يُحمَّل ديناميكيًا مع بديل CSV.

## التحويل من Vercel (بهذا الترتيب)

1. انشر وتحقق على رابط `workers.dev`: تسجيل دخول، لوحة القيادة، `/api/health`.
2. اربط النطاق بالـ Worker وحدّث `APP_URL` في `wrangler.jsonc`.
3. غيّر رابط الويبهوك وروابط OAuth في تطبيق Meta إلى النطاق الجديد.
4. أوقف مشروع Vercel. **لا تشغّل الاثنين معًا على نفس القاعدة بعد الخطوة ٣** —
   كلاهما سيسحب من الطابور نفسه؛ هذا آمن (SKIP LOCKED) لكنه يُربك التشخيص.

## محليًا

```bash
npm run cf:preview   # بناء + تشغيل في workerd (يحتاج Node 22 و .dev.vars)
```
