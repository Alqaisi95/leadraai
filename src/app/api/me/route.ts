import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { prisma } from "@/lib/db";
import { SESSION_COOKIE } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value ?? req.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token) return NextResponse.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 });
  const session = await prisma.session.findUnique({
    where: { tokenHash: createHash("sha256").update(token).digest("hex") },
    include: { user: { include: { memberships: { where: { status: "ACTIVE" }, include: { organization: { select: { id: true, name: true } } } } } } },
  });
  if (!session || session.revokedAt || session.expiresAt < new Date()) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 });
  }
  return NextResponse.json({
    user: { id: session.user.id, fullName: session.user.fullName, email: session.user.email, mfaEnabled: session.user.mfaEnabled },
    memberships: session.user.memberships.map((m) => ({ organizationId: m.organizationId, organizationName: m.organization.name, role: m.role })),
  });
}
