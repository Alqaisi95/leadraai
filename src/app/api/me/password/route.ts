/** POST /api/me/password { current, next } — change own password; other sessions are signed out. */
import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { withAuth, err } from "@/lib/api";
import { audit } from "@/lib/audit";
import { hashPassword, SESSION_COOKIE } from "@/lib/auth";

const schema = z.object({
  current: z.string().min(1),
  next: z.string().min(10, "كلمة المرور الجديدة 10 أحرف على الأقل").max(200),
});

export const POST = withAuth(async (req, ctx, correlationId) => {
  const body = schema.safeParse(await req.json());
  if (!body.success) return err(422, "VALIDATION", body.error.issues.map((i) => i.message).join("; "), correlationId);

  const user = await prisma.user.findUniqueOrThrow({ where: { id: ctx.userId } });
  const valid = user.passwordHash ? await bcrypt.compare(body.data.current, user.passwordHash) : false;
  if (!valid) return err(403, "INVALID_PASSWORD", "كلمة المرور الحالية غير صحيحة", correlationId);
  if (body.data.current === body.data.next) return err(422, "SAME_PASSWORD", "اختر كلمة مرور مختلفة", correlationId);

  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(body.data.next) } });

  const token = req.cookies.get(SESSION_COOKIE)?.value ?? req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  const currentHash = createHash("sha256").update(token).digest("hex");
  await prisma.session.updateMany({
    where: { userId: user.id, revokedAt: null, NOT: { tokenHash: currentHash } },
    data: { revokedAt: new Date() },
  });
  await audit({ ctx, action: "user.password_change", entityType: "user", entityId: user.id, correlationId });
  return NextResponse.json({ ok: true });
});
