/**
 * GET    /api/knowledge-sources/:id  — source + its chunks (what the AI reads)
 * PATCH  /api/knowledge-sources/:id  — title, project, enable/disable, or replace content (new version)
 * DELETE /api/knowledge-sources/:id
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withAuth, err } from "@/lib/api";
import { requirePermission } from "@/lib/rbac";
import { TenantMismatchError } from "@/lib/tenant";
import { audit } from "@/lib/audit";
import { chunkText } from "@/lib/ai/knowledge";

function idFrom(url: string) {
  return new URL(url).pathname.split("/").at(-1)!;
}

async function load(id: string, organizationId: string) {
  const source = await prisma.knowledgeSource.findFirst({ where: { id, organizationId } });
  if (!source) throw new TenantMismatchError();
  return source;
}

export const GET = withAuth(async (req, ctx) => {
  requirePermission(ctx.role, "knowledge.manage");
  const source = await load(idFrom(req.url), ctx.organizationId);
  const documents = await prisma.knowledgeDocument.findMany({
    where: { sourceId: source.id },
    orderBy: { chunkIndex: "asc" },
    select: { id: true, chunkIndex: true, content: true },
    take: 200,
  });
  return NextResponse.json({ ...source, documents });
});

const patchSchema = z.object({
  title: z.string().min(2).max(300).optional(),
  projectId: z.string().nullable().optional(),
  status: z.enum(["ACTIVE", "DISABLED"]).optional(),
  content: z.string().min(10).max(500_000).optional(),
});

export const PATCH = withAuth(async (req, ctx, correlationId) => {
  requirePermission(ctx.role, "knowledge.manage");
  const source = await load(idFrom(req.url), ctx.organizationId);
  const body = patchSchema.safeParse(await req.json());
  if (!body.success) return err(422, "VALIDATION", body.error.issues.map((i) => i.message).join("; "), correlationId);
  const { content, ...data } = body.data;

  if (data.projectId) {
    const project = await prisma.project.findFirst({ where: { id: data.projectId, organizationId: ctx.organizationId } });
    if (!project) return err(404, "NOT_FOUND", "Project not found", correlationId);
  }

  let chunks: number | undefined;
  if (content) {
    const parts = chunkText(content);
    await prisma.$transaction([
      prisma.knowledgeDocument.deleteMany({ where: { sourceId: source.id } }),
      prisma.knowledgeDocument.createMany({ data: parts.map((c, i) => ({ sourceId: source.id, chunkIndex: i, content: c })) }),
    ]);
    chunks = parts.length;
  }
  const updated = await prisma.knowledgeSource.update({
    where: { id: source.id },
    data: { ...data, ...(content ? { version: { increment: 1 } } : {}) },
  });
  await audit({
    ctx, action: "knowledge.update", entityType: "knowledge_source", entityId: source.id,
    before: { title: source.title, status: source.status, version: source.version },
    after: { title: updated.title, status: updated.status, version: updated.version, chunks }, correlationId,
  });
  return NextResponse.json({ ...updated, chunks });
});

export const DELETE = withAuth(async (req, ctx, correlationId) => {
  requirePermission(ctx.role, "knowledge.manage");
  const source = await load(idFrom(req.url), ctx.organizationId);
  await prisma.knowledgeSource.delete({ where: { id: source.id } });
  await audit({ ctx, action: "knowledge.delete", entityType: "knowledge_source", entityId: source.id, before: { title: source.title }, correlationId });
  return NextResponse.json({ ok: true });
});
