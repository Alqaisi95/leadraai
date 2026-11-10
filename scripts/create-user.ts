/**
 * Create (or reset) a login for local/staging use.
 *
 * The seed builds a whole demo world; this does the one thing you usually
 * want on its own — a user you can sign in as, attached to an ACTIVE
 * membership and a live subscription so the dashboard is not gated.
 *
 * Usage:
 *   npx tsx scripts/create-user.ts --email you@example.com [--password '...']
 *     [--name 'الاسم'] [--role ORG_ADMIN] [--org 'اسم الشركة'] [--plan growth]
 *
 * Re-running with the same email resets that user's password rather than
 * failing on the unique constraint.
 */
import { PrismaClient, type RoleKey } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { getPlan } from "../src/lib/plans";

const prisma = new PrismaClient();

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

/** Readable but not guessable — the operator has to copy it out of the log. */
function generatePassword(): string {
  return `Leadra-${randomBytes(9).toString("base64url")}`;
}

async function main() {
  const email = arg("email")?.trim().toLowerCase();
  if (!email) throw new Error("--email is required");

  const password = arg("password") ?? generatePassword();
  const generated = !arg("password");
  const fullName = arg("name", "مستخدم جديد")!;
  const role = arg("role", "ORG_ADMIN") as RoleKey;
  const orgName = arg("org", "شركة الديار العقارية (تجريبي)")!;
  // An explicit --plan is an instruction to move the org onto that package;
  // the default is only a floor for an org that has no subscription yet.
  const planArg = arg("plan");
  const planKey = planArg ?? "growth";

  const plan = getPlan(planKey);
  if (!plan) throw new Error(`unknown plan: ${planKey}`);

  // Reuse the org if it already exists so repeated runs land the whole team in
  // one tenant instead of scattering a tenant per user.
  const org =
    (await prisma.organization.findFirst({ where: { name: orgName } })) ??
    (await prisma.organization.create({
      data: { name: orgName, country: "IQ", timezone: "Asia/Baghdad", language: "AR" },
    }));

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.upsert({
    where: { email },
    create: { email, fullName, passwordHash, language: "AR" },
    update: { passwordHash, fullName },
  });

  await prisma.organizationMember.upsert({
    where: { organizationId_userId: { organizationId: org.id, userId: user.id } },
    create: { organizationId: org.id, userId: user.id, role, status: "ACTIVE", joinedAt: new Date() },
    update: { role, status: "ACTIVE" },
  });

  // Without an ACTIVE subscription getEntitlements reports NONE and the AI
  // paths refuse to run, which reads as a broken account rather than a new one.
  await prisma.subscription.upsert({
    where: { organizationId: org.id },
    create: {
      organizationId: org.id,
      planKey: plan.key,
      status: "ACTIVE",
      limits: plan.limits,
      currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
    },
    update: planArg ? { planKey: plan.key, status: "ACTIVE", limits: plan.limits, trialEndsAt: null } : {},
  });

  // A previous lockout would otherwise reject a password we just set.
  await prisma.loginAttempt.deleteMany({ where: { email, success: false } });

  console.log("\n✅ الحساب جاهز\n");
  console.log(`  البريد     : ${email}`);
  console.log(`  كلمة المرور: ${password}${generated ? "   ← مولّدة، احفظها الآن" : ""}`);
  console.log(`  الدور      : ${role}`);
  console.log(`  الشركة     : ${org.name}`);
  console.log(`  الباقة     : ${plan.name} (${plan.key})\n`);
  console.log("  سجّل الدخول على http://localhost:3000/login\n");
}

main()
  .catch((e) => {
    console.error("❌", e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
