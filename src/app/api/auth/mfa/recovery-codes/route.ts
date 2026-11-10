/**
 * Recovery codes: how many are left (GET), and replace the set (POST).
 *
 * There is deliberately no way to read the existing codes. Only hashes are
 * stored, so they cannot be shown again — and a user who has mislaid them is
 * not worse off for being given a fresh set, which is what POST does.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withAuth, err } from "@/lib/api";
import { verifyPassword } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { generateRecoveryCodes, remainingRecoveryCodes, CODE_COUNT } from "@/lib/mfa-recovery";

export const GET = withAuth(async (_req, ctx) => {
  const remaining = await remainingRecoveryCodes(ctx.userId);
  return NextResponse.json({ remaining, total: CODE_COUNT, low: remaining <= 2 });
});

const schema = z.object({ password: z.string().min(1) });

export const POST = withAuth(async (req, ctx, correlationId) => {
  const body = schema.safeParse(await req.json());
  if (!body.success) return err(422, "VALIDATION", "password required", correlationId);

  const user = await prisma.user.findUniqueOrThrow({ where: { id: ctx.userId } });
  if (!user.mfaEnabled) {
    return err(400, "MFA_NOT_ENABLED", "MFA is not enabled", correlationId);
  }

  // The password is re-checked even though the session is already
  // authenticated. A stolen session must not be enough to mint a permanent
  // bypass of the second factor — which is exactly what a fresh set of
  // recovery codes is.
  if (!user.passwordHash || !(await verifyPassword(body.data.password, user.passwordHash))) {
    return err(401, "INVALID_PASSWORD", "Incorrect password", correlationId);
  }

  // Replaces the old set: anything previously written down stops working.
  const recoveryCodes = await generateRecoveryCodes(ctx.userId);
  await audit({ ctx, action: "auth.mfa_recovery_codes_regenerated", correlationId });

  return NextResponse.json({ ok: true, recoveryCodes, showOnce: true });
});
