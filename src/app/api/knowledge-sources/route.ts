/**
 * GET  /api/knowledge-sources
 * POST /api/knowledge-sources
 *   - JSON: { title, type: TEXT|URL, content, projectId? }
 *   - multipart: file (PDF/DOCX/TXT/MD/CSV), title?, projectId?
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withAuth, err } from "@/lib/api";
import { requirePermission } from "@/lib/rbac";
import { scoped } from "@/lib/tenant";
import { audit } from "@/lib/audit";
import { chunkText } from "@/lib/ai/knowledge";
import { extractText, ExtractionError } from "@/lib/ai/extract";

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_CHARS = 500_000;

export const GET = withAuth(async (_req, ctx) => {
  requirePermission(ctx.role, "knowledge.manage");
  const items = await prisma.knowledgeSource.findMany({
    where: scoped(ctx),
    include: { _count: { select: { documents: true } }, project: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ items });
});

const jsonSchema = z.object({
  title: z.string().min(2).max(300),
  type: z.enum(["TEXT", "URL"]),
  content: z.string().min(10).max(MAX_CHARS),
  projectId: z.string().optional(),
});

export const POST = withAuth(async (req, ctx, correlationId) => {
  requirePermission(ctx.role, "knowledge.manage");

  let title: string, type: "PDF" | "DOCX" | "CSV" | "TEXT" | "URL", content: string;
  let projectId: string | undefined;
  let originalUrl: string | undefined;

  if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return err(422, "VALIDATION", "file is required", correlationId);
    if (file.size > MAX_BYTES) return err(413, "TOO_LARGE", "الملف أكبر من 10MB", correlationId);
    try {
      const extracted = await extractText(file);
      type = extracted.type;
      content = extracted.text.slice(0, MAX_CHARS);
    } catch (e) {
      if (e instanceof ExtractionError) return err(422, e.code, e.message, correlationId);
      throw e;
    }
    title = String(form.get("title") || file.name.replace(/\.[^.]+$/, "")).slice(0, 300);
    projectId = String(form.get("projectId") || "") || undefined;
  } else {
    const body = jsonSchema.safeParse(await req.json());
    if (!body.success) return err(422, "VALIDATION", "title, type, content required", correlationId);
    ({ title, type, content, projectId } = body.data);
    if (type === "URL") originalUrl = content.split(/\s/)[0];
  }

  if (projectId) {
    const project = await prisma.project.findFirst({ where: { id: projectId, organizationId: ctx.organizationId } });
    if (!project) return err(404, "NOT_FOUND", "Project not found", correlationId);
  }

  const source = await prisma.knowledgeSource.create({
    data: { organizationId: ctx.organizationId, projectId, type, title, originalUrl, status: "PROCESSING" },
  });
  const chunks = chunkText(content);
  await prisma.knowledgeDocument.createMany({
    data: chunks.map((c, i) => ({ sourceId: source.id, chunkIndex: i, content: c })),
  });
  const updated = await prisma.knowledgeSource.update({ where: { id: source.id }, data: { status: "ACTIVE" } });
  await audit({ ctx, action: "knowledge.create", entityType: "knowledge_source", entityId: source.id, after: { title, type, chunks: chunks.length }, correlationId });

  return NextResponse.json({ ...updated, chunks: chunks.length, characters: content.length }, { status: 201 });
});
