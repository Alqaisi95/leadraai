/**
 * Pipeline stage management. Stages carry live opportunities, so deletion is
 * only allowed once a stage is empty — the board must never lose a deal.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withAuth, err } from "@/lib/api";
import { requirePermission } from "@/lib/rbac";
import { TenantMismatchError } from "@/lib/tenant";
import { audit } from "@/lib/audit";

async function ownedStage(organizationId: string, stageId: string) {
  return prisma.pipelineStage.findFirst({
    where: { id: stageId, pipeline: { organizationId } },
    include: { _count: { select: { opportunities: { where: { archivedAt: null } } } } },
  });
}

const createSchema = z.object({
  pipelineId: z.string(),
  name: z.string().min(1).max(80),
  afterStageId: z.string().optional(),
});

export const POST = withAuth(async (req, ctx, correlationId) => {
  requirePermission(ctx.role, "pipeline.manage");
  const body = createSchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) return err(422, "VALIDATION", "pipelineId واسم المرحلة مطلوبان", correlationId);

  const pipeline = await prisma.pipeline.findFirst({
    where: { id: body.data.pipelineId, organizationId: ctx.organizationId },
    include: { stages: { orderBy: { order: "asc" } } },
  });
  if (!pipeline) throw new TenantMismatchError();
  if (pipeline.stages.length >= 20) return err(422, "LIMIT", "الحد الأقصى ٢٠ مرحلة", correlationId);

  // insert after a given stage, or before the terminal won/lost stages
  const after = body.data.afterStageId
    ? pipeline.stages.find((s) => s.id === body.data.afterStageId)
    : [...pipeline.stages].reverse().find((s) => !s.isWon && !s.isLost);
  const insertAt = (after?.order ?? pipeline.stages.length) + 1;

  const [, created] = await prisma.$transaction([
    prisma.pipelineStage.updateMany({
      where: { pipelineId: pipeline.id, order: { gte: insertAt } },
      data: { order: { increment: 1 } },
    }),
    prisma.pipelineStage.create({
      data: { pipelineId: pipeline.id, name: body.data.name.trim(), order: insertAt },
    }),
  ]);

  await audit({
    ctx,
    action: "pipeline.stage_create",
    entityType: "pipeline_stage",
    entityId: created.id,
    after: created,
    correlationId,
  });
  return NextResponse.json(created, { status: 201 });
});

const patchSchema = z.object({
  stageId: z.string(),
  name: z.string().min(1).max(80).optional(),
  requiresPhone: z.boolean().optional(),
});

export const PATCH = withAuth(async (req, ctx, correlationId) => {
  requirePermission(ctx.role, "pipeline.manage");
  const body = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) return err(422, "VALIDATION", "stageId مطلوب", correlationId);

  const stage = await ownedStage(ctx.organizationId, body.data.stageId);
  if (!stage) throw new TenantMismatchError();

  const updated = await prisma.pipelineStage.update({
    where: { id: stage.id },
    data: {
      ...(body.data.name ? { name: body.data.name.trim() } : {}),
      ...(body.data.requiresPhone !== undefined
        ? { entryRules: body.data.requiresPhone ? { requires: ["phone"] } : undefined }
        : {}),
    },
  });

  await audit({
    ctx,
    action: "pipeline.stage_update",
    entityType: "pipeline_stage",
    entityId: stage.id,
    before: stage,
    after: updated,
    correlationId,
  });
  return NextResponse.json(updated);
});

export const DELETE = withAuth(async (req, ctx, correlationId) => {
  requirePermission(ctx.role, "pipeline.manage");
  const stageId = new URL(req.url).searchParams.get("stageId");
  if (!stageId) return err(422, "VALIDATION", "stageId مطلوب", correlationId);

  const stage = await ownedStage(ctx.organizationId, stageId);
  if (!stage) throw new TenantMismatchError();

  if (stage._count.opportunities > 0) {
    return err(
      409,
      "STAGE_NOT_EMPTY",
      `المرحلة تحتوي ${stage._count.opportunities} فرصة — انقلها أولًا`,
      correlationId,
    );
  }
  if (stage.isWon || stage.isLost) {
    return err(409, "TERMINAL_STAGE", "لا يمكن حذف مرحلتي البيع والفقدان", correlationId);
  }

  await prisma.$transaction([
    prisma.pipelineStage.delete({ where: { id: stage.id } }),
    prisma.pipelineStage.updateMany({
      where: { pipelineId: stage.pipelineId, order: { gt: stage.order } },
      data: { order: { decrement: 1 } },
    }),
  ]);

  await audit({
    ctx,
    action: "pipeline.stage_delete",
    entityType: "pipeline_stage",
    entityId: stage.id,
    before: stage,
    correlationId,
  });
  return NextResponse.json({ ok: true });
});
