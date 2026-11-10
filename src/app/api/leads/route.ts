import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withAuth, parsePagination, err } from "@/lib/api";
import { requirePermission, hasPermission } from "@/lib/rbac";
import { scoped } from "@/lib/tenant";
import { audit } from "@/lib/audit";
import { autoAssign } from "@/lib/distribution";
import { applyScoringEvent } from "@/lib/scoring";

const SORTS: Record<string, any> = {
  score: { score: "desc" },
  recent: { lastInteractionAt: "desc" },
  created: { createdAt: "desc" },
  name: { fullName: "asc" },
};

export const GET = withAuth(async (req, ctx) => {
  requirePermission(ctx.role, "leads.read");
  const { skip, take, page, pageSize } = parsePagination(req);
  const p = new URL(req.url).searchParams;
  const q = (p.get("q") ?? "").trim();

  const where = scoped(ctx, {
    mergedIntoLeadId: null,
    ...(p.get("purpose") ? { purpose: p.get("purpose")! as any } : {}),
    ...(p.get("temperature") ? { temperature: p.get("temperature")! as any } : {}),
    ...(p.get("projectId") ? { interestedProjectId: p.get("projectId")! } : {}),
    ...(p.get("minScore") ? { score: { gte: Number(p.get("minScore")) } } : {}),
    ...(q
      ? {
          OR: [
            { fullName: { contains: q, mode: "insensitive" as const } },
            { igUsername: { contains: q, mode: "insensitive" as const } },
            { phone: { contains: q } },
            { area: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
    // agents see only their own book; managers can filter to a specific agent
    ...(ctx.role === "AGENT"
      ? { ownerMemberId: ctx.memberId }
      : p.get("ownerId")
        ? { ownerMemberId: p.get("ownerId") === "unassigned" ? null : p.get("ownerId")! }
        : {}),
  });

  const [items, total, byTemperature] = await Promise.all([
    prisma.lead.findMany({
      where,
      orderBy: SORTS[p.get("sort") ?? "score"] ?? SORTS.score,
      skip,
      take,
      include: {
        interestedProject: { select: { id: true, name: true } },
        owner: { select: { id: true, user: { select: { fullName: true } } } },
        tags: { include: { tag: true } },
        opportunities: {
          where: { archivedAt: null },
          take: 1,
          orderBy: { createdAt: "desc" },
          select: { id: true, value: true, stage: { select: { name: true, isWon: true, isLost: true } } },
        },
      },
    }),
    prisma.lead.count({ where }),
    prisma.lead.groupBy({
      by: ["temperature"],
      where: scoped(ctx, {
        mergedIntoLeadId: null,
        ...(ctx.role === "AGENT" ? { ownerMemberId: ctx.memberId } : {}),
      }),
      _count: true,
    }),
  ]);

  return NextResponse.json({
    items,
    page,
    pageSize,
    total,
    counts: Object.fromEntries(byTemperature.map((t) => [t.temperature, t._count])),
  });
});

const createSchema = z.object({
  fullName: z.string().min(2).max(120),
  phone: z.string().max(30).optional(),
  email: z.string().email().optional().or(z.literal("")),
  purpose: z.enum(["BUY", "RENT", "INVEST", "UNKNOWN"]).default("UNKNOWN"),
  city: z.string().max(100).optional(),
  area: z.string().max(100).optional(),
  propertyType: z.string().max(100).optional(),
  budgetMin: z.number().nonnegative().optional(),
  budgetMax: z.number().nonnegative().optional(),
  interestedProjectId: z.string().optional(),
  ownerMemberId: z.string().optional(),
  source: z.string().max(60).optional(),
});

/** Manual entry — walk-ins and phone enquiries never touch a webhook. */
export const POST = withAuth(async (req, ctx, correlationId) => {
  requirePermission(ctx.role, "leads.update");
  const body = createSchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success)
    return err(422, "VALIDATION", body.error.issues.map((i) => i.message).join("; "), correlationId);

  const d = body.data;
  if (d.budgetMin && d.budgetMax && d.budgetMin > d.budgetMax) {
    return err(422, "VALIDATION", "الحد الأدنى للميزانية أكبر من الأعلى", correlationId);
  }

  // an agent may only file leads under their own name
  const owner = d.ownerMemberId ?? (ctx.role === "AGENT" ? ctx.memberId : undefined);
  if (owner && owner !== ctx.memberId) requirePermission(ctx.role, "leads.assign");

  const lead = await prisma.lead.create({
    data: {
      organizationId: ctx.organizationId,
      fullName: d.fullName,
      phone: d.phone || undefined,
      email: d.email || undefined,
      purpose: d.purpose,
      city: d.city || undefined,
      area: d.area || undefined,
      propertyType: d.propertyType || undefined,
      budgetMin: d.budgetMin,
      budgetMax: d.budgetMax,
      interestedProjectId: d.interestedProjectId || undefined,
      ownerMemberId: owner,
      lastInteractionAt: new Date(),
    },
  });

  if (d.phone) {
    await prisma.leadIdentifier
      .create({ data: { leadId: lead.id, kind: "phone", value: d.phone } })
      .catch(() => {});
    await applyScoringEvent(lead.id, "PHONE_SHARED");
  }
  if (d.area || d.city) await applyScoringEvent(lead.id, "AREA_PROVIDED");
  if (d.budgetMin || d.budgetMax) await applyScoringEvent(lead.id, "BUDGET_PROVIDED");
  if (!owner) await autoAssign(lead.id).catch(() => {});

  // place the lead on the default pipeline so it appears on the board
  const pipeline = await prisma.pipeline.findFirst({
    where: { organizationId: ctx.organizationId, isDefault: true },
    include: { stages: { orderBy: { order: "asc" }, take: 1 } },
  });
  if (pipeline?.stages[0]) {
    await prisma.opportunity.create({
      data: {
        organizationId: ctx.organizationId,
        leadId: lead.id,
        pipelineId: pipeline.id,
        stageId: pipeline.stages[0].id,
        value: d.budgetMax,
      },
    });
  }

  await audit({
    ctx,
    action: "lead.create_manual",
    entityType: "lead",
    entityId: lead.id,
    after: lead,
    correlationId,
  });
  return NextResponse.json(lead, { status: 201 });
});
