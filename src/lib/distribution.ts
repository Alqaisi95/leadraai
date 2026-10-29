/**
 * Auto-assignment: Round Robin with per-agent cap (requirements §4.8).
 */
import { prisma } from "./db";

const DEFAULT_AGENT_CAP = 30;

export async function autoAssign(leadId: string): Promise<string | null> {
  const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
  if (lead.ownerMemberId) return lead.ownerMemberId;

  const agents = await prisma.organizationMember.findMany({
    where: { organizationId: lead.organizationId, role: "AGENT", status: "ACTIVE" },
    include: { _count: { select: { assignedLeads: { where: { mergedIntoLeadId: null } } } } },
  });

  const eligible = agents
    .filter((a) => a._count.assignedLeads < DEFAULT_AGENT_CAP)
    .sort((a, b) => a._count.assignedLeads - b._count.assignedLeads); // least-loaded first ≈ fair round robin

  const target = eligible[0];
  if (!target) return null; // all at cap → stays unassigned, manager notified

  await prisma.lead.update({ where: { id: leadId }, data: { ownerMemberId: target.id } });
  return target.id;
}

/** Reassign all open leads of an absent member (§4.8 إعادة التوزيع عند الغياب). */
export async function reassignFrom(memberId: string) {
  const leads = await prisma.lead.findMany({ where: { ownerMemberId: memberId, mergedIntoLeadId: null } });
  for (const lead of leads) {
    await prisma.lead.update({ where: { id: lead.id }, data: { ownerMemberId: null } });
    await autoAssign(lead.id);
  }
  return leads.length;
}
