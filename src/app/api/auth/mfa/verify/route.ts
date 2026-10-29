import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withAuth, err } from "@/lib/api";
import { verifyTotp } from "@/lib/totp";
import { audit } from "@/lib/audit";

const schema = z.object({ code: z.string().min(6).max(7) });

export const POST = withAuth(async (req, ctx, correlationId) => {
  const body = schema.safeParse(await req.json());
  if (!body.success) return err(422, "VALIDATION", "code required", correlationId);

  const user = await prisma.user.findUniqueOrThrow({ where: { id: ctx.userId } });
  if (!user.mfaSecret || !verifyTotp(user.mfaSecret, body.data.code)) {
    return err(401, "MFA_INVALID", "Invalid code", correlationId);
  }
  await prisma.user.update({ where: { id: ctx.userId }, data: { mfaEnabled: true } });
  await audit({ ctx, action: "auth.mfa_enabled", correlationId });
  return NextResponse.json({ ok: true });
});
