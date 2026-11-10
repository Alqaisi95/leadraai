/**
 * Editing and removing a knowledge source.
 *
 * Editing the content re-chunks it: the old chunks are what the assistant is
 * currently quoting, so leaving them behind would keep stale facts in play
 * while the operator believes they corrected them.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withAuth, err } from "@/lib/api";
import { requirePermission } from "@/lib/rbac";
import { TenantMismatchError } from "@/lib/tenant";
import { audit } from "@/lib/audit";
import { chunkText } from "@/lib/ai/knowledge";

function idFrom(pathname: string) {
  return pathname.split("/").at(-1)!;
}

export const GET = withAuth(async (req, ctx) => {
  requirePermission(ctx.role, "knowledge.manage");
  const id = idFrom(req.nextUrl.pathname);

  const source = await prisma.knowledgeSource.findFirst({
    where: { id, organizationId: ctx.organizationId },
    include: { documents: { orderBy: { chunkIndex: "asc" } }, project: { select: { id: true, name: true } } },
  });
  if (!source) throw new TenantMismatchError();

  // reassemble so the editor shows what was originally pasted
  return NextResponse.json({
    source: { ...source, documents: undefined },
    content: source.documents.map((d) => d.content).join("\n\n"),
    chunks: source.documents.length,
  });
});

const patchSchema = z.object({
  title: z.string().min(2).max(300).optional(),
  content: z.string().min(10).max(500_000).optional(),
  projectId: z.string().nullish(),
  status: z.enum(["ACTIVE", "DISABLED"]).optional(),
});

export const PATCH = withAuth(async (req, ctx, correlationId) => {
  requirePermission(ctx.role, "knowledge.manage");
  const id = idFrom(req.nextUrl.pathname);

  const body = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return err(422, "VALIDATION", body.error.issues.map((i) => i.message).join("; "), correlationId);
  }

  const source = await prisma.knowledgeSource.findFirst({
    where: { id, organizationId: ctx.organizationId },
  });
  if (!source) throw new TenantMismatchError();

  if (body.data.projectId) {
    const project = await prisma.project.findFirst({
      where: { id: body.data.projectId, organizationId: ctx.organizationId },
    });
    if (!project) return err(422, "VALIDATION", "المشروع غير موجود", correlationId);
  }

  const chunks = body.data.content !== undefined ? chunkText(body.data.content) : null;

  const [updated] = await prisma.$transaction([
    prisma.knowledgeSource.update({
      where: { id: source.id },
      data: {
        ...(body.data.title ? { title: body.data.title } : {}),
        ...(body.data.projectId !== undefined ? { projectId: body.data.projectId } : {}),
        ...(body.data.status ? { status: body.data.status } : {}),
        // bump the version so it is visible that the assistant's source changed
        ...(chunks ? { version: { increment: 1 }, status: "ACTIVE" as const } : {}),
      },
    }),
    // replace, never append: stale chunks would keep being quoted
    ...(chunks
      ? [
          prisma.knowledgeDocument.deleteMany({ where: { sourceId: source.id } }),
          prisma.knowledgeDocument.createMany({
            data: chunks.map((content, i) => ({ sourceId: source.id, chunkIndex: i, content })),
          }),
        ]
      : []),
  ]);

  await audit({
    ctx,
    action: "knowledge.update",
    entityType: "knowledge_source",
    entityId: source.id,
    before: { title: source.title, version: source.version },
    after: { title: updated.title, version: updated.version, rechunked: chunks?.length ?? 0 },
    correlationId,
  });

  return NextResponse.json({ ...updated, chunks: chunks?.length });
});

export const DELETE = withAuth(async (req, ctx, correlationId) => {
  requirePermission(ctx.role, "knowledge.manage");
  const id = idFrom(req.nextUrl.pathname);

  const source = await prisma.knowledgeSource.findFirst({
    where: { id, organizationId: ctx.organizationId },
  });
  if (!source) throw new TenantMismatchError();

  // documents cascade with the source
  await prisma.knowledgeSource.delete({ where: { id: source.id } });
  await audit({
    ctx,
    action: "knowledge.delete",
    entityType: "knowledge_source",
    entityId: source.id,
    before: { title: source.title },
    correlationId,
  });
  return NextResponse.json({ ok: true });
});
