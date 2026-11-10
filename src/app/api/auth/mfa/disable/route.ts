/**
 * Turn MFA off.
 *
 * This did not exist, which is half of why losing an authenticator was
 * unrecoverable: login() demands a TOTP code once mfaEnabled is set, and
 * nothing could unset it short of an operator editing the database.
 *
 * It requires the password, not just a session: otherwise a stolen session
 * could strip the account's second factor, which inverts the point of it.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withAuth, err } from "@/lib/api";
import { verifyPassword } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { clearRecoveryCodes } from "@/lib/mfa-recovery";

const schema = z.object({ password: z.string().min(1) });

export const POST = withAuth(async (req, ctx, correlationId) => {
  const body = schema.safeParse(await req.json());
  if (!body.success) return err(422, "VALIDATION", "password required", correlationId);

  const user = await prisma.user.findUniqueOrThrow({ where: { id: ctx.userId } });
  if (!user.passwordHash || !(await verifyPassword(body.data.password, user.passwordHash))) {
    return err(401, "INVALID_PASSWORD", "Incorrect password", correlationId);
  }

  // The secret goes too. Leaving it behind would mean re-enabling MFA silently
  // reuses a secret the user may have had reason to abandon — a phone handed
  // on, or an authenticator app someone else still has.
  await prisma.user.update({
    where: { id: ctx.userId },
    data: { mfaEnabled: false, mfaSecret: null },
  });
  await clearRecoveryCodes(ctx.userId);

  await audit({ ctx, action: "auth.mfa_disabled", correlationId });
  return NextResponse.json({ ok: true });
});
