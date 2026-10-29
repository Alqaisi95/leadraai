import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { withAuth } from "@/lib/api";
import { requirePermission } from "@/lib/rbac";
import { oauthUrl } from "@/lib/meta";
import { prisma } from "@/lib/db";

/** R1.5 — dedicated oauth_states with 10-minute expiry, single-use. */
export const GET = withAuth(async (_req, ctx) => {
  requirePermission(ctx.role, "integrations.manage");
  const state = randomBytes(24).toString("hex");
  await prisma.oauthState.create({
    data: { state, organizationId: ctx.organizationId, userId: ctx.userId, expiresAt: new Date(Date.now() + 10 * 60_000) },
  });
  return NextResponse.json({ url: oauthUrl(state) });
});
