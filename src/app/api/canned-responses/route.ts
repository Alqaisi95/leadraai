/** Saved replies agents insert with one click. */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withAuth, err } from "@/lib/api";
import { requirePermission } from "@/lib/rbac";
import { scoped } from "@/lib/tenant";

export const GET = withAuth(async (_req, ctx) => {
  // anyone who can reply needs the list, not just admins
  requirePermission(ctx.role, "conversations.reply");
  const items = await prisma.cannedResponse.findMany({
    where: scoped(ctx),
    orderBy: [{ useCount: "desc" }, { title: "asc" }],
  });
  return NextResponse.json({ items });
});

const createSchema = z.object({
  title: z.string().min(2).max(80),
  body: z.string().min(2).max(2000),
});

export const POST = withAuth(async (req, ctx, correlationId) => {
  requirePermission(ctx.role, "org.settings.manage");
  const parsed = createSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return err(422, "VALIDATION", "العنوان والنص مطلوبان", correlationId);

  try {
    const created = await prisma.cannedResponse.create({
      data: { organizationId: ctx.organizationId, ...parsed.data },
    });
    return NextResponse.json(created, { status: 201 });
  } catch (e: any) {
    if (e?.code === "P2002") return err(409, "DUPLICATE", "يوجد رد بهذا العنوان", correlationId);
    throw e;
  }
});

const patchSchema = z.object({
  id: z.string(),
  title: z.string().min(2).max(80).optional(),
  body: z.string().min(2).max(2000).optional(),
  /** Bump the counter when an agent actually inserts it. */
  used: z.boolean().optional(),
});

export const PATCH = withAuth(async (req, ctx, correlationId) => {
  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return err(422, "VALIDATION", "id مطلوب", correlationId);

  // recording usage is an agent action; editing the text is an admin one
  if (parsed.data.used) requirePermission(ctx.role, "conversations.reply");
  else requirePermission(ctx.role, "org.settings.manage");

  const existing = await prisma.cannedResponse.findFirst({
    where: { id: parsed.data.id, organizationId: ctx.organizationId },
  });
  if (!existing) return err(404, "NOT_FOUND", "الرد غير موجود", correlationId);

  const updated = await prisma.cannedResponse.update({
    where: { id: existing.id },
    data: parsed.data.used
      ? { useCount: { increment: 1 } }
      : {
          ...(parsed.data.title ? { title: parsed.data.title } : {}),
          ...(parsed.data.body ? { body: parsed.data.body } : {}),
        },
  });
  return NextResponse.json(updated);
});

export const DELETE = withAuth(async (req, ctx, correlationId) => {
  requirePermission(ctx.role, "org.settings.manage");
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return err(422, "VALIDATION", "id مطلوب", correlationId);

  const existing = await prisma.cannedResponse.findFirst({
    where: { id, organizationId: ctx.organizationId },
  });
  if (!existing) return err(404, "NOT_FOUND", "الرد غير موجود", correlationId);

  await prisma.cannedResponse.delete({ where: { id: existing.id } });
  return NextResponse.json({ ok: true });
});
