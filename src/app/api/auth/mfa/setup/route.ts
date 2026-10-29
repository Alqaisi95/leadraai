/** R1.3: generate TOTP secret — enabled only after /verify confirms a valid code. */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api";
import { generateSecret, otpauthUrl } from "@/lib/totp";

export const POST = withAuth(async (_req, ctx) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: ctx.userId } });
  const secret = generateSecret();
  await prisma.user.update({ where: { id: ctx.userId }, data: { mfaSecret: secret, mfaEnabled: false } });
  return NextResponse.json({ secret, otpauth: otpauthUrl(user.email, secret) });
});
