/** Full lead profile: identity, deal, score history, notes, tasks & appointments. */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withAuth, err } from "@/lib/api";
import { requirePermission } from "@/lib/rbac";
import { TenantMismatchError } from "@/lib/tenant";
import { audit } from "@/lib/audit";
import { applyScoringEvent } from "@/lib/scoring";
import { findDuplicateCandidates } from "@/lib/leads";

function idFrom(pathname: string) {
  return pathname.split("/").at(-1)!;
}

/** An AGENT is scoped to their own book; everyone else sees the whole org. */
function visibility(ctx: { role: string; memberId: string; organizationId: string }, id: string) {
  return {
    id,
    organizationId: ctx.organizationId,
    ...(ctx.role === "AGENT" ? { ownerMemberId: ctx.memberId } : {}),
  };
}

export const GET = withAuth(async (req, ctx) => {
  requirePermission(ctx.role, "leads.read");
  const id = idFrom(req.nextUrl.pathname);

  const lead = await prisma.lead.findFirst({
    where: visibility(ctx, id),
    include: {
      interestedProject: { select: { id: true, name: true } },
      campaign: { select: { name: true } },
      owner: { select: { id: true, user: { select: { fullName: true } } } },
      conversation: { select: { id: true, status: true, lastMessageAt: true } },
      opportunities: {
        where: { archivedAt: null },
        include: { stage: { select: { id: true, name: true, isWon: true, isLost: true } } },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      scoreEvents: { orderBy: { createdAt: "desc" }, take: 30 },
      notes: { orderBy: { createdAt: "desc" }, take: 50 },
      tasks: {
        orderBy: { createdAt: "desc" },
        take: 20,
        include: { assignee: { select: { user: { select: { fullName: true } } } } },
      },
      appointments: {
        orderBy: { startsAt: "desc" },
        take: 20,
        include: { member: { select: { user: { select: { fullName: true } } } } },
      },
      tags: { include: { tag: true } },
      identifiers: true,
    },
  });
  if (!lead) throw new TenantMismatchError();

  // resolve note authors in one round-trip
  const authorIds = [...new Set(lead.notes.map((n) => n.authorMemberId))];
  const authors = await prisma.organizationMember.findMany({
    where: { id: { in: authorIds } },
    select: { id: true, user: { select: { fullName: true } } },
  });
  const nameByMember = new Map(authors.map((a) => [a.id, a.user.fullName]));

  const duplicates = await findDuplicateCandidates(ctx.organizationId, lead.id).catch(() => []);

  return NextResponse.json({
    lead: {
      ...lead,
      notes: lead.notes.map((n) => ({ ...n, author: nameByMember.get(n.authorMemberId) ?? "—" })),
    },
    duplicates: duplicates.map((d: any) => ({ ...d.lead, matchedOn: d.kind })),
  });
});

const patchSchema = z.object({
  fullName: z.string().min(2).max(120).nullish(),
  phone: z.string().max(30).nullish(),
  email: z.string().email().nullish().or(z.literal("")),
  purpose: z.enum(["BUY", "RENT", "INVEST", "UNKNOWN"]).optional(),
  city: z.string().max(100).nullish(),
  area: z.string().max(100).nullish(),
  propertyType: z.string().max(100).nullish(),
  budgetMin: z.number().nonnegative().nullish(),
  budgetMax: z.number().nonnegative().nullish(),
  paymentMethod: z.string().max(100).nullish(),
  buyTimeframe: z.string().max(100).nullish(),
  nextStep: z.string().max(300).nullish(),
  interestedProjectId: z.string().nullish(),
  ownerMemberId: z.string().nullish(),
  marketingConsent: z.boolean().optional(),
});

export const PATCH = withAuth(async (req, ctx, correlationId) => {
  requirePermission(ctx.role, "leads.update");
  const id = idFrom(req.nextUrl.pathname);

  const body = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success)
    return err(422, "VALIDATION", body.error.issues.map((i) => i.message).join("; "), correlationId);

  const lead = await prisma.lead.findFirst({ where: visibility(ctx, id) });
  if (!lead) throw new TenantMismatchError();

  const d = body.data;
  // reassigning someone else's lead is a manager action
  if (d.ownerMemberId !== undefined && d.ownerMemberId !== lead.ownerMemberId) {
    requirePermission(ctx.role, "leads.assign");
    if (d.ownerMemberId) {
      const member = await prisma.organizationMember.findFirst({
        where: { id: d.ownerMemberId, organizationId: ctx.organizationId, status: "ACTIVE" },
      });
      if (!member) return err(422, "VALIDATION", "الموظف غير موجود أو غير نشط", correlationId);
    }
  }

  const min = d.budgetMin !== undefined ? d.budgetMin : lead.budgetMin ? Number(lead.budgetMin) : null;
  const max = d.budgetMax !== undefined ? d.budgetMax : lead.budgetMax ? Number(lead.budgetMax) : null;
  if (min != null && max != null && min > max) {
    return err(422, "VALIDATION", "الحد الأدنى للميزانية أكبر من الأعلى", correlationId);
  }

  // only send defined keys through; `null` clears a field intentionally
  const data = Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined)) as any;
  if (data.email === "") data.email = null;

  const updated = await prisma.lead.update({
    where: { id: lead.id },
    data: { ...data, lastInteractionAt: new Date() },
    include: { owner: { select: { user: { select: { fullName: true } } } } },
  });

  // newly-learned facts still earn their score, whoever entered them
  if (!lead.phone && updated.phone) {
    await prisma.leadIdentifier
      .create({ data: { leadId: lead.id, kind: "phone", value: updated.phone } })
      .catch(() => {});
    await applyScoringEvent(lead.id, "PHONE_SHARED");
  }
  if (!lead.area && !lead.city && (updated.area || updated.city))
    await applyScoringEvent(lead.id, "AREA_PROVIDED");
  if (!lead.budgetMin && !lead.budgetMax && (updated.budgetMin || updated.budgetMax)) {
    await applyScoringEvent(lead.id, "BUDGET_PROVIDED");
  }

  await audit({
    ctx,
    action: "lead.update",
    entityType: "lead",
    entityId: lead.id,
    before: lead,
    after: updated,
    correlationId,
  });

  return NextResponse.json(updated);
});
