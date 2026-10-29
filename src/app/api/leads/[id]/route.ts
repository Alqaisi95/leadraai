/**
 * GET   /api/leads/:id — everything about one lead: details, conversation,
 *       score history with reasons, opportunity stage, notes, tasks, appointments.
 * PATCH /api/leads/:id — edit details; reassign owner needs leads.assign.
 * Agents only see and edit their own leads.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withAuth, err } from "@/lib/api";
import { requirePermission, hasPermission } from "@/lib/rbac";
import { TenantMismatchError, type TenantContext } from "@/lib/tenant";
import { audit } from "@/lib/audit";
import { applyScoringEvent } from "@/lib/scoring";

function idFrom(url: string) {
  return new URL(url).pathname.split("/").at(-1)!;
}

async function loadLead(id: string, ctx: TenantContext) {
  const lead = await prisma.lead.findFirst({
    where: { id, organizationId: ctx.organizationId, ...(ctx.role === "AGENT" ? { ownerMemberId: ctx.memberId } : {}) },
  });
  if (!lead) throw new TenantMismatchError();
  return lead;
}

export const GET = withAuth(async (req, ctx) => {
  requirePermission(ctx.role, "leads.read");
  const { id } = await loadLead(idFrom(req.url), ctx);

  const lead = await prisma.lead.findUniqueOrThrow({
    where: { id },
    include: {
      interestedProject: { select: { id: true, name: true } },
      campaign: { select: { id: true, name: true } },
      owner: { select: { id: true, user: { select: { fullName: true } } } },
      scoreEvents: { orderBy: { createdAt: "desc" }, take: 30 },
      notes: { orderBy: { createdAt: "desc" }, take: 50 },
      tasks: { orderBy: [{ status: "asc" }, { dueAt: "asc" }], take: 50 },
      appointments: { orderBy: { startsAt: "desc" }, take: 20, include: { project: { select: { name: true } } } },
      opportunities: { where: { archivedAt: null }, include: { stage: { select: { name: true, isWon: true, isLost: true } } } },
      tags: { include: { tag: true } },
      conversation: {
        select: {
          id: true, status: true, customerUsername: true, lastMessageAt: true,
          messages: { orderBy: { createdAt: "desc" }, take: 60, select: { id: true, senderType: true, body: true, createdAt: true } },
        },
      },
    },
  });

  // note authors: one query instead of a relation per note
  const authorIds = [...new Set(lead.notes.map((n: any) => n.authorMemberId))];
  const authors = authorIds.length
    ? await prisma.organizationMember.findMany({ where: { id: { in: authorIds } }, select: { id: true, user: { select: { fullName: true } } } })
    : [];
  const authorName = Object.fromEntries(authors.map((a: any) => [a.id, a.user.fullName]));

  return NextResponse.json({
    ...lead,
    notes: lead.notes.map((n: any) => ({ ...n, authorName: authorName[n.authorMemberId] ?? "—" })),
    conversation: lead.conversation ? { ...lead.conversation, messages: [...lead.conversation.messages].reverse() } : null,
    canAssign: hasPermission(ctx.role, "leads.assign"),
  });
});

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
const patchSchema = z.object({
  fullName: optionalText(120),
  phone: optionalText(30),
  email: z.string().trim().email().nullable().optional().or(z.literal("").transform(() => null)),
  purpose: z.enum(["BUY", "INVEST", "RENT", "UNKNOWN"]).optional(),
  city: optionalText(80),
  area: optionalText(120),
  propertyType: optionalText(60),
  budgetMin: z.number().nonnegative().nullable().optional(),
  budgetMax: z.number().nonnegative().nullable().optional(),
  paymentMethod: optionalText(60),
  buyTimeframe: optionalText(60),
  nextStep: optionalText(300),
  interestedProjectId: z.string().nullable().optional(),
  ownerMemberId: z.string().nullable().optional(),
});

export const PATCH = withAuth(async (req, ctx, correlationId) => {
  requirePermission(ctx.role, "leads.update");
  const lead = await loadLead(idFrom(req.url), ctx);
  const body = patchSchema.safeParse(await req.json());
  if (!body.success) return err(422, "VALIDATION", body.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "), correlationId);
  const data: Record<string, unknown> = { ...body.data };
  for (const k of Object.keys(data)) if (data[k] === "") data[k] = null;

  if (data.ownerMemberId !== undefined && data.ownerMemberId !== lead.ownerMemberId) {
    requirePermission(ctx.role, "leads.assign");
    if (data.ownerMemberId) {
      const owner = await prisma.organizationMember.findFirst({
        where: { id: data.ownerMemberId as string, organizationId: ctx.organizationId, status: "ACTIVE" },
      });
      if (!owner) return err(404, "NOT_FOUND", "Member not found", correlationId);
    }
  }
  if (data.interestedProjectId) {
    const project = await prisma.project.findFirst({ where: { id: data.interestedProjectId as string, organizationId: ctx.organizationId } });
    if (!project) return err(404, "NOT_FOUND", "Project not found", correlationId);
  }
  if (data.budgetMin != null && data.budgetMax != null && (data.budgetMin as number) > (data.budgetMax as number)) {
    return err(422, "VALIDATION", "الحد الأدنى للميزانية أكبر من الأعلى", correlationId);
  }

  const updated = await prisma.lead.update({ where: { id: lead.id }, data });

  // Details entered by staff count the same as details the customer gave the AI (one-time events).
  if (!lead.phone && updated.phone) await applyScoringEvent(lead.id, "PHONE_SHARED");
  if (!lead.budgetMax && !lead.budgetMin && (updated.budgetMax || updated.budgetMin)) await applyScoringEvent(lead.id, "BUDGET_PROVIDED");
  if (!lead.area && updated.area) await applyScoringEvent(lead.id, "AREA_PROVIDED");

  await audit({ ctx, action: "lead.update", entityType: "lead", entityId: lead.id, before: lead, after: updated, correlationId });
  return NextResponse.json(await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } }));
});
