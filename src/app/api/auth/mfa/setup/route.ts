/** R1.3: generate TOTP secret — enabled only after /verify confirms a valid code. */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth, err } from "@/lib/api";
import { generateSecret, otpauthUrl } from "@/lib/totp";

export const POST = withAuth(async (_req, ctx, correlationId) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: ctx.userId } });
  // Never let a (possibly hijacked) session silently reset an active second factor.
  if (user.mfaEnabled) return err(409, "MFA_ALREADY_ENABLED", "المصادقة الثنائية مفعّلة بالفعل", correlationId);
  const secret = generateSecret();
  await prisma.user.update({ where: { id: ctx.userId }, data: { mfaSecret: secret, mfaEnabled: false } });
  return NextResponse.json({ secret, otpauth: otpauthUrl(user.email, secret) });
});
