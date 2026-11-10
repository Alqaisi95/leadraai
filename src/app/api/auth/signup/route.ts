/**
 * Self-serve company registration: creates org + admin user + default pipeline
 * + default scoring rules + trial subscription, then signs the user in.
 */
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { hashPassword, login, SESSION_COOKIE, CSRF_COOKIE } from "@/lib/auth";
import { checkRateLimit, checkDurableLimit } from "@/lib/ratelimit";
import { issueVerification } from "@/lib/email-verification";

const schema = z.object({
  organizationName: z.string().min(2).max(200),
  fullName: z.string().min(2).max(120),
  email: z.string().email(),
  password: z.string().min(10).max(200),
});

const STAGES = [
  "جديد",
  "تأهيل أولي",
  "مؤهل",
  "تواصل بشري",
  "موعد زيارة",
  "تمت الزيارة",
  "تفاوض",
  "حجز",
  "بيع",
  "مفقود / غير مؤهل",
];

const RULES = [
  { event: "BUDGET_PROVIDED", points: 20, label: "حدد الميزانية" },
  { event: "AREA_PROVIDED", points: 10, label: "حدد المنطقة" },
  { event: "PHONE_SHARED", points: 15, label: "شارك رقم الهاتف" },
  { event: "VISIT_REQUESTED", points: 30, label: "طلب موعد زيارة" },
  { event: "NEAR_TERM_PURCHASE", points: 15, label: "موعد شراء قريب" },
  { event: "BUDGET_MISMATCH", points: -20, label: "عدم توافق الميزانية" },
  { event: "NO_REPLY_48H", points: -8, label: "عدم الرد خلال يومين" },
  { event: "SPAM_MESSAGE", points: -100, label: "رسالة Spam" },
];

export async function POST(req: NextRequest) {
  const correlationId = randomUUID();
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();

  const rl = checkRateLimit(`signup:${ip ?? "unknown"}`, "/api/auth/signup");
  const durable = await checkDurableLimit(`ip:${ip ?? "unknown"}`, "/api/auth/signup");
  if (!rl.ok || !durable.ok) {
    return NextResponse.json(
      { error: { code: "RATE_LIMITED", message: "محاولات كثيرة", correlationId } },
      { status: 429 },
    );
  }

  const body = schema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION",
          message: "تحقق من البيانات — كلمة المرور 10 أحرف على الأقل",
          correlationId,
        },
      },
      { status: 422 },
    );
  }

  const email = body.data.email.trim().toLowerCase();
  if (await prisma.user.findUnique({ where: { email } })) {
    return NextResponse.json(
      {
        error: {
          code: "EMAIL_TAKEN",
          message: "هذا البريد مسجل بالفعل — سجّل الدخول بدلًا من ذلك",
          correlationId,
        },
      },
      { status: 409 },
    );
  }

  const passwordHash = await hashPassword(body.data.password);

  const userId = await prisma.$transaction(
    async (tx) => {
      const org = await tx.organization.create({
        data: { name: body.data.organizationName, country: "IQ", timezone: "Asia/Baghdad", language: "AR" },
      });
      const user = await tx.user.create({
        data: { email, fullName: body.data.fullName, passwordHash, language: "AR" },
      });
      await tx.organizationMember.create({
        data: {
          organizationId: org.id,
          userId: user.id,
          role: "ORG_ADMIN",
          status: "ACTIVE",
          joinedAt: new Date(),
        },
      });

      const pipeline = await tx.pipeline.create({
        data: { organizationId: org.id, name: "مسار المبيعات الافتراضي", isDefault: true },
      });
      // One statement, not ten. Created one at a time this loop alone spent ten
      // sequential round trips inside the transaction, and against a database in
      // another region that pushed the whole thing past Prisma's five-second
      // interactive-transaction timeout — self-serve signup failed with a 500
      // every time. None of these rows need an id back, so there is no reason
      // for them to be sequential.
      await tx.pipelineStage.createMany({
        data: STAGES.map((name, i) => ({
          pipelineId: pipeline.id,
          name,
          order: i + 1,
          isWon: name === "بيع",
          isLost: i === STAGES.length - 1,
          entryRules: name === "موعد زيارة" ? { requires: ["phone"] } : undefined,
        })),
      });
      await tx.scoringRule.createMany({ data: RULES.map((r) => ({ organizationId: org.id, ...r })) });
      await tx.subscription.create({
        data: {
          organizationId: org.id,
          planKey: "trial",
          status: "TRIAL",
          trialEndsAt: new Date(Date.now() + 14 * 86400_000),
          limits: { igAccounts: 1, users: 5, monthlyConversations: 500, monthlyAiRuns: 500 },
        },
      });

      return user.id;
    },
    // Generous on purpose: this runs once per customer, over whatever link they
    // happen to have, and a timeout here loses a signup outright.
    { timeout: 20_000 },
  );

  // Outside the transaction: mailing is slow and allowed to fail, and holding a
  // database transaction open across an SMTP round trip is how the signup path
  // started timing out in the first place.
  await issueVerification(userId).catch(() => {});

  const session = await login(email, body.data.password, {
    ip,
    userAgent: req.headers.get("user-agent") ?? undefined,
  });
  if (!session.ok) {
    return NextResponse.json({ ok: true, signedIn: false });
  }

  const secure = process.env.NODE_ENV === "production";
  const maxAge = 7 * 86400;
  const res = NextResponse.json({ ok: true, signedIn: true });
  res.cookies.set(SESSION_COOKIE, session.token, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge,
  });
  res.cookies.set(CSRF_COOKIE, session.csrf, { httpOnly: false, secure, sameSite: "lax", path: "/", maxAge });
  return res;
}
