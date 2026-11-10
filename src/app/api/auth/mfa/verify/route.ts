import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withAuth, err } from "@/lib/api";
import { verifyTotp, openSecret } from "@/lib/totp";
import { audit } from "@/lib/audit";
import { generateRecoveryCodes } from "@/lib/mfa-recovery";

const schema = z.object({ code: z.string().min(6).max(7) });

export const POST = withAuth(async (req, ctx, correlationId) => {
  const body = schema.safeParse(await req.json());
  if (!body.success) return err(422, "VALIDATION", "code required", correlationId);

  const user = await prisma.user.findUniqueOrThrow({ where: { id: ctx.userId } });
  const secret = user.mfaSecret ? openSecret(user.mfaSecret) : null;
  if (!secret || !verifyTotp(secret, body.data.code)) {
    return err(401, "MFA_INVALID", "Invalid code", correlationId);
  }
  await prisma.user.update({ where: { id: ctx.userId }, data: { mfaEnabled: true } });

  // Issued at the same moment MFA is switched on, never later. Enabling a
  // second factor without handing over a way back in is how losing a phone
  // becomes losing the account, and a user who has to go looking for recovery
  // codes afterwards generally does not.
  const recoveryCodes = await generateRecoveryCodes(ctx.userId);

  await audit({ ctx, action: "auth.mfa_enabled", correlationId });

  // The only time these exist in plaintext. Not retrievable afterwards, only
  // replaceable — hence `showOnce`, which the UI uses to insist they are saved.
  return NextResponse.json({ ok: true, recoveryCodes, showOnce: true });
});
