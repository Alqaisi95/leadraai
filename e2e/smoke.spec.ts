import { test, expect } from "@playwright/test";
import { clickAndExpectRequest } from "./helpers";

test.describe("مسارات المنصة الأساسية", () => {
  test("لوحة القيادة تعرض المؤشرات والقمع", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByText("محادثات جديدة")).toBeVisible();
    // exact: the comparison note below the title names this metric too
    await expect(page.getByText("قيمة الـ Pipeline", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: /قمع المبيعات/ })).toBeVisible();
  });

  test("لوحة القيادة تقارن بالفترة السابقة", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByText(/الأسهم تقارن بالفترة السابقة المماثلة/)).toBeVisible();
    // one indicator per period-based metric; the point-in-time cards have none
    await expect(page.getByTestId("delta")).toHaveCount(4);
  });

  test("صندوق المحادثات يفتح محادثة ويتيح اقتراح رد", async ({ page }) => {
    await page.goto("/inbox");
    await page
      .locator("button")
      .filter({ hasText: /جاهز للبيع|دافئ|بارد/ })
      .first()
      .click();
    await expect(page.getByPlaceholder(/اكتب ردك/)).toBeVisible();
    await expect(page.getByRole("button", { name: /اقترح ردًا/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /ملخّص/ })).toBeVisible();
  });

  test("لوحة العميل تُدرج وحدة في الرد بدل إعادة كتابة السعر", async ({ page }) => {
    await page.goto("/inbox");
    await page
      .locator("button")
      .filter({ hasText: /جاهز للبيع|دافئ|بارد/ })
      .first()
      .click();

    const reply = page.getByLabel("نص الرد");
    await expect(reply).toBeVisible();
    await reply.fill("خيارات مناسبة:");

    // Retyping a price by hand is how a wrong one reaches a customer. The
    // inserted text is copied verbatim from the inventory.
    const insert = page.getByRole("button", { name: "أدرج في الرد" }).first();
    await insert.waitFor({ timeout: 20_000 });
    await insert.click();

    // Appended, not replacing what the agent already typed.
    await expect(reply).toHaveValue(/^خيارات مناسبة: .+/);
    await expect(reply).toHaveValue(/\$|السعر عند الطلب/);
  });

  test("لوحة المسار تعرض المراحل وبطاقات العملاء", async ({ page }) => {
    await page.goto("/leads");
    await expect(page.getByRole("heading", { name: "العملاء والمسار" })).toBeVisible();
    await expect(page.getByText("تأهيل أولي")).toBeVisible();
    await expect(page.getByRole("button", { name: /مرحلة جديدة/ })).toBeVisible();
  });

  test("التبديل إلى الجدول يعرض العملاء بالفرز", async ({ page }) => {
    await page.goto("/leads");
    await page.getByRole("button", { name: "جدول" }).click();
    await expect(page.locator("table")).toBeVisible();
    await expect(page.getByRole("button", { name: "الأحدث نشاطًا" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "المرحلة" })).toBeVisible();
  });

  test("الفلاتر تضيّق نتائج الجدول", async ({ page }) => {
    await page.goto("/leads");
    await page.getByRole("button", { name: "جدول" }).click();
    await expect(page.locator("tbody tr").first()).toBeVisible();

    // COLD, not SALES_READY: scores decay on inactivity (NO_REPLY_48H), so a
    // hot lead can legitimately vanish between runs — a cold one cannot warm up
    // on its own. Assert the filter's contract: every visible row matches.
    await page.getByRole("combobox").first().selectOption("COLD");
    const rows = page.locator("tbody tr");
    await expect(rows.first()).toBeVisible();
    for (const row of await rows.all()) {
      await expect(row).toContainText("بارد");
    }
  });

  test("حوار العميل اليدوي يفتح بحقوله", async ({ page }) => {
    await page.goto("/leads");
    await page.getByRole("button", { name: /^عميل$/ }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByText("الاسم الكامل")).toBeVisible();
    await expect(page.getByText("الميزانية من ($)")).toBeVisible();
  });

  test("ملف العميل يعرض البيانات والملاحظات وأزرار الإجراءات", async ({ page }) => {
    await page.goto("/leads");
    await page.locator('a[href^="/leads/"]').first().click();
    await expect(page.getByRole("heading", { name: /بيانات العميل/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /الوحدات المطابقة/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /سجل النقاط/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /الملاحظات الداخلية/ })).toBeVisible();
    for (const name of ["مهمة", "موعد", "تعديل"]) {
      await expect(page.getByRole("button", { name })).toBeVisible();
    }
  });

  test("حوار تعديل العميل يفتح محمّلًا بالقيم الحالية", async ({ page }) => {
    await page.goto("/leads");
    await page.locator('a[href^="/leads/"]').first().click();
    await page.getByRole("button", { name: "تعديل" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByText("المسؤول")).toBeVisible();
    await expect(page.getByText("الخطوة التالية")).toBeVisible();
  });

  test("المخزون يعرض جدول الوحدات", async ({ page }) => {
    await page.goto("/inventory");
    await expect(page.getByRole("heading", { name: "المخزون العقاري" })).toBeVisible();
    await expect(page.locator("table")).toBeVisible();
  });

  test("معاينة الاستيراد تُبلّغ عن الأخطاء وتمنع التنفيذ", async ({ page }) => {
    await page.goto("/inventory");
    await page.getByRole("button", { name: /استيراد/ }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // one good row, one unknown project, one unknown status
    await dialog
      .locator("textarea")
      .fill(
        [
          "المشروع,رقم الوحدة,السعر,الحالة",
          'مجمع الياسمين السكني,E2E-1,"95,000",متاحة',
          "مشروع وهمي,E2E-2,90000,متاحة",
          "مجمع الياسمين السكني,E2E-3,90000,قيد التفاوض",
        ].join("\n"),
      );
    await dialog.getByRole("button", { name: "معاينة" }).click();

    await expect(dialog.getByText("صفوف تحتاج تصحيحًا", { exact: false })).toBeVisible({ timeout: 20_000 });
    await expect(dialog.getByText("غير موجود", { exact: false })).toBeVisible();
    // nothing may be written while any row is invalid
    await expect(dialog.getByRole("button", { name: /تنفيذ الاستيراد/ })).toBeDisabled();
  });

  test("لوحة الأوامر تفتح بـ ⌘K وتُرجع نتائج", async ({ page }) => {
    await page.goto("/dashboard");
    await page.keyboard.press("ControlOrMeta+k");
    const input = page.getByPlaceholder(/ابحث عن عميل/);
    await expect(input).toBeVisible();
    await input.fill("محمد");
    await expect(page.locator('a[href^="/leads/"]').first()).toBeVisible({ timeout: 15_000 });
  });

  test("الإعدادات تعرض الفريق وقواعد التنقيط", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "الإعدادات" })).toBeVisible();
    await expect(page.getByText("هدف الرد الأول", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "الفريق" }).click();
    await expect(page.getByRole("button", { name: /دعوة عضو/ })).toBeVisible();
    await expect(page.getByText("admin@demo.leadra.ai").first()).toBeVisible();
    await page.getByRole("button", { name: /قواعد التنقيط/ }).click();
    await expect(page.getByText("شارك رقم الهاتف")).toBeVisible();
  });

  test("المهام والمواعيد والمعرفة والتقارير تفتح بلا أخطاء", async ({ page }) => {
    for (const [path, heading] of [
      ["/tasks", "المهام"],
      ["/appointments", "المواعيد"],
      ["/knowledge", "معرفة الذكاء الاصطناعي"],
      ["/reports", "التقارير"],
      ["/notifications", "الإشعارات"],
      ["/integrations", "مركز التكاملات"],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    }
  });

  test("جدول العملاء يتيح التحديد الجماعي", async ({ page }) => {
    await page.goto("/leads");
    await page.getByRole("button", { name: "جدول" }).click();
    const rowBox = page.locator('input[type="checkbox"][aria-label^="تحديد "]').first();
    await rowBox.waitFor();
    await rowBox.check();
    await expect(page.getByText(/\d+ محدَّدون/)).toBeVisible();
    await expect(page.getByRole("combobox").filter({ hasText: "تخصيص لـ" })).toBeVisible();
    await expect(page.getByRole("combobox").filter({ hasText: "نقل إلى مرحلة" })).toBeVisible();
    // clearing the selection puts the bar away again
    await page.getByRole("button", { name: "إلغاء التحديد" }).click();
    await expect(page.getByText(/محدَّدون/)).toHaveCount(0);
  });

  test("تفضيلات الإشعارات تقفل التنبيهات الحرجة", async ({ page }) => {
    await page.goto("/settings");
    await page.getByRole("button", { name: "الإشعارات" }).click();
    // exact: the intro paragraph and the SLA_WARNING hint both contain this phrase
    await expect(page.getByText("تجاوز مهلة الرد", { exact: true })).toBeVisible();
    // a critical alert cannot be hidden in-app, but its email half stays free
    await expect(page.getByLabel("تجاوز مهلة الرد داخل التطبيق")).toBeDisabled();
    await expect(page.getByLabel("تجاوز مهلة الرد بالبريد")).toBeEnabled();
    // an ordinary alert is fully under the member's control
    await expect(page.getByLabel("مهمة متأخرة داخل التطبيق")).toBeEnabled();
    // nothing was changed, so there is nothing to save
    await expect(page.getByRole("button", { name: "حفظ التفضيلات" })).toBeDisabled();
  });

  test("شاشة الباقة تعرض الاستهلاك وتمنع النزول غير الممكن", async ({ page }) => {
    await page.goto("/settings");
    await page.getByRole("button", { name: "الباقة والاشتراك" }).click();

    await expect(page.getByRole("heading", { name: /باقتك الحالية/ })).toBeVisible();
    // every metered dimension gets a bar — nothing is advertised that is not counted.
    // Per-period metrics carry a "هذا الشهر" qualifier inside the same element,
    // so the label is a prefix of the bar's text, not the whole of it.
    for (const label of ["المستخدمون", "حسابات Instagram", "المحادثات", "ردود المساعد الآلي"]) {
      await expect(page.getByText(new RegExp(`^${label}`)).first()).toBeVisible();
    }

    // the picker offers the paid tiers and never the internal ones
    await expect(page.getByRole("heading", { name: "النمو", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "مؤسسي", exact: true })).toHaveCount(0);

    // no processor is wired in, and the screen says so rather than implying a charge
    await expect(page.getByText(/لا توجد بوابة دفع مربوطة/)).toBeVisible();

    // Switching plans is a confirmed action, and the confirmation spells out the
    // new limits before anything changes. Cancelled here on purpose: the suite
    // shares one seeded org, and a spec that leaves it on a different plan
    // changes what every later spec is looking at.
    await page.getByRole("button", { name: "التحويل إلى هذه الباقة" }).first().click();
    await expect(page.getByRole("heading", { name: /التحويل إلى باقة/ })).toBeVisible();
    await expect(page.getByText("ستصبح حدودك:")).toBeVisible();
    await expect(page.getByText(/لن يُسحب أي مبلغ/)).toBeVisible();
    await page.getByRole("button", { name: "إلغاء" }).click();
    await expect(page.getByRole("heading", { name: /باقتك الحالية/ })).toBeVisible();
  });

  // NOT COVERED: the server refuses a downgrade whose limits the org already
  // exceeds (409 DOWNGRADE_BLOCKED). The seeded org sits inside every public
  // tier, so there is no plan it can fail to fit — proving that path needs a
  // fixture with more seats than the target allows, which the UI cannot set up.
});

/**
 * Self-serve signup, end to end.
 *
 * This is the highest-value path in the product and it had no coverage at all —
 * which is exactly how it came to be completely broken in production: the route
 * wrapped fifteen sequential statements in one transaction and blew past
 * Prisma's timeout against a database in another region, returning 500 to every
 * attempt. Nothing noticed, because nothing looked.
 *
 * One caveat worth stating plainly: that particular failure was latency-driven
 * and does NOT reproduce against a fast local Postgres, which is what CI uses.
 * This spec would have caught it running against the production database and
 * would not have caught it in CI. It is here because the path deserves coverage
 * on its own merits — a signup that silently stops creating the default
 * pipeline, or stops signing the owner in, fails here on any database.
 */
test.describe("التسجيل الذاتي", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("ينشئ شركة كاملة ويوصل صاحبها إلى لوحة القيادة", async ({ page }) => {
    const stamp = Date.now();
    const email = `e2e-signup-${stamp}@example.test`;

    await page.goto("/signup");
    await clickAndExpectRequest(
      page,
      async () => {
        await page.getByLabel("اسم الشركة").fill(`شركة اختبار ${stamp}`);
        await page.getByLabel("اسمك").fill("مالك الاختبار");
        await page.getByLabel("البريد الإلكتروني").fill(email);
        await page.getByLabel("كلمة المرور (١٠ أحرف على الأقل)").fill("LongEnoughPass1");
        await page.getByRole("button", { name: "إنشاء الحساب" }).click();
      },
      "/api/auth/signup",
    );

    // Generous: the route creates an org, a user, a membership, a pipeline with
    // ten stages, eight scoring rules and a subscription, then signs in.
    await page.waitForURL("**/dashboard", { timeout: 60_000 });
    await expect(page.getByRole("heading", { name: /لوحة القيادة/ })).toBeVisible();

    // A brand-new organization has no data, and the dashboard has to say so
    // rather than render broken.
    await expect(page.getByText("محادثات جديدة")).toBeVisible({ timeout: 30_000 });

    // The default pipeline is what makes the product usable at all — a signup
    // that skipped it would look fine here and be useless on the next screen.
    await page.goto("/leads");
    await expect(page.getByText("تأهيل أولي")).toBeVisible({ timeout: 30_000 });

    // Unverified until the emailed link is clicked, and the shell says so.
    await expect(page.getByText(/أكّد .* لتفعيل ربط Instagram/)).toBeVisible();
  });

  test("يرفض بريدًا مسجّلًا بدل إنشاء حساب مكرّر", async ({ page }) => {
    await page.goto("/signup");
    await clickAndExpectRequest(
      page,
      async () => {
        await page.getByLabel("اسم الشركة").fill("شركة مكرّرة");
        await page.getByLabel("اسمك").fill("مالك");
        await page.getByLabel("البريد الإلكتروني").fill("admin@demo.leadra.ai");
        await page.getByLabel("كلمة المرور (١٠ أحرف على الأقل)").fill("LongEnoughPass1");
        await page.getByRole("button", { name: "إنشاء الحساب" }).click();
      },
      "/api/auth/signup",
    );

    await expect(page.getByText(/مسجل بالفعل/)).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(/\/signup/);
  });
});

test.describe("بلا جلسة", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("صفحة الهبوط تعرض دعوة التسجيل", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("عملاؤك يراسلونك");
    await expect(page.getByRole("link", { name: /ابدأ مجانًا/ })).toBeVisible();
  });

  test("رفض الدخول ببيانات خاطئة", async ({ page }) => {
    await page.goto("/login");
    // Unique per run: five failures against one address trips the 15-minute
    // lockout, and the next run then gets "too many attempts" instead of the
    // wrong-credentials message this test is about. A fresh address every time
    // keeps the suite re-runnable against a database that remembers.
    const email = `wrong-${Date.now()}@example.com`;
    await clickAndExpectRequest(
      page,
      async () => {
        await page.getByLabel("البريد الإلكتروني").fill(email);
        await page.getByLabel("كلمة المرور").fill("wrong-password-here");
        await page.getByRole("button", { name: "دخول" }).click();
      },
      "/api/auth/login",
    );
    await expect(page.getByText(/غير صحيحة/)).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test("الـ APIs المحمية ترفض غير المسجّلين", async ({ request }) => {
    for (const path of ["/api/leads", "/api/units", "/api/members", "/api/audit"]) {
      expect((await request.get(path)).status()).toBe(401);
    }
  });

  test("طلب استعادة كلمة المرور لا يكشف إن كان البريد مسجّلًا", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("link", { name: "نسيت كلمة المرور؟" }).click();
    await expect(page.getByRole("heading", { name: "نسيت كلمة المرور؟" })).toBeVisible();

    // An address that certainly does not exist must produce the same screen a
    // real one would — the endpoint is public, and a different answer here
    // would let anyone test an email list for Leadra accounts.
    await clickAndExpectRequest(
      page,
      async () => {
        await page.getByLabel("البريد الإلكتروني").fill("definitely-not-registered@example.test");
        await page.getByRole("button", { name: "أرسل رابط إعادة التعيين" }).click();
      },
      "/api/auth/forgot",
    );

    // Generous: this is the first hit on /api/auth/forgot, so the dev server
    // compiles the route before it can answer.
    await expect(page.getByRole("heading", { name: "تحقّق من بريدك" })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText(/لا نكشف ما إذا كان بريد ما مسجّلًا/)).toBeVisible();
  });

  test("رابط إعادة تعيين غير صالح يُرفض بوضوح", async ({ page }) => {
    await page.goto("/reset/this-token-was-never-issued");
    await expect(page.getByRole("heading", { name: "هذا الرابط لم يعد صالحًا" })).toBeVisible();
    await expect(page.getByRole("button", { name: "اطلب رابطًا جديدًا" })).toBeVisible();
  });

  test("فحص الصحة يرد ok بلا مصادقة", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.status()).toBe(200);
    expect((await res.json()).status).toBe("ok");
  });
});
