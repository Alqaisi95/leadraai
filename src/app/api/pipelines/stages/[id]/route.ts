/** PATCH /api/pipelines/stages/:id — rename a stage or set the lead fields required to enter it. */
import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { withAuth, err } from "@/lib/api";
import { requirePermission } from "@/lib/rbac";
import { TenantMismatchError } from "@/lib/tenant";
import { audit } from "@/lib/audit";
import { REQUIRABLE_FIELDS } from "@/lib/pipeline";

const schema = z.object({
  name: z.string().trim().min(2).max(60).optional(),
  requires: z.array(z.string()).max(10).refine((xs) => xs.every((x) => x in REQUIRABLE_FIELDS), "unknown field").optional(),
});

export const PATCH = withAuth(async (req, ctx, correlationId) => {
  requirePermission(ctx.role, "pipeline.manage");
  const id = new URL(req.url).pathname.split("/").at(-1)!;
  const body = schema.safeParse(await req.json());
  if (!body.success) return err(422, "VALIDATION", body.error.issues.map((i) => i.message).join("; "), correlationId);

  const stage = await prisma.pipelineStage.findFirst({
    where: { id, pipeline: { organizationId: ctx.organizationId } },
  });
  if (!stage) throw new TenantMismatchError();

  const updated = await prisma.pipelineStage.update({
    where: { id },
    data: {
      ...(body.data.name ? { name: body.data.name } : {}),
      ...(body.data.requires ? { entryRules: body.data.requires.length ? { requires: body.data.requires } : Prisma.DbNull } : {}),
    },
  });
  await audit({
    ctx, action: "pipeline_stage.update", entityType: "pipeline_stage", entityId: id,
    before: { name: stage.name, entryRules: stage.entryRules }, after: { name: updated.name, entryRules: updated.entryRules }, correlationId,
  });
  return NextResponse.json(updated);
});
