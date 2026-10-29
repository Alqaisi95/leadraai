import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withAuth, err } from "@/lib/api";
import { requirePermission } from "@/lib/rbac";
import { scoped } from "@/lib/tenant";
import { chunkText } from "@/lib/ai/knowledge";

export const GET = withAuth(async (_req, ctx) => {
  requirePermission(ctx.role, "knowledge.manage");
  const items = await prisma.knowledgeSource.findMany({
    where: scoped(ctx),
    include: { _count: { select: { documents: true } }, project: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ items });
});

/** MVP: accept raw text/URL content directly. File parsing (PDF/DOCX) lands with upload service. */
const createSchema = z.object({
  title: z.string().min(2).max(300),
  type: z.enum(["TEXT", "URL"]),
  content: z.string().min(10).max(500_000),
  projectId: z.string().optional(),
});

export const POST = withAuth(async (req, ctx, correlationId) => {
  requirePermission(ctx.role, "knowledge.manage");
  const body = createSchema.safeParse(await req.json());
  if (!body.success) return err(422, "VALIDATION", "title, type, content required", correlationId);

  const source = await prisma.knowledgeSource.create({
    data: {
      organizationId: ctx.organizationId,
      projectId: body.data.projectId,
      type: body.data.type,
      title: body.data.title,
      status: "PROCESSING",
    },
  });

  const chunks = chunkText(body.data.content);
  await prisma.knowledgeDocument.createMany({
    data: chunks.map((content, i) => ({ sourceId: source.id, chunkIndex: i, content })),
  });
  const updated = await prisma.knowledgeSource.update({ where: { id: source.id }, data: { status: "ACTIVE" } });

  return NextResponse.json({ ...updated, chunks: chunks.length }, { status: 201 });
});
