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

/**
 * Reassign all open leads of an absent member (§4.8 إعادة التوزيع عند الغياب).
 *
 * The obvious loop — clear one lead, re-run autoAssign, repeat — costs four
 * queries per lead and re-reads the same agent roster every iteration. An agent
 * going on leave with a few hundred open leads turned one request into a
 * thousand round trips.
 *
 * Instead: read the roster once, work out the whole allocation in memory, and
 * write one UPDATE per receiving agent. The distribution rule is unchanged —
 * least-loaded first, capped — but the running counts are now tracked locally
 * as leads are handed out, which the loop was relying on the database to do.
 */
export async function reassignFrom(memberId: string) {
  const leads = await prisma.lead.findMany({
    where: { ownerMemberId: memberId, mergedIntoLeadId: null },
    select: { id: true, organizationId: true },
  });
  if (leads.length === 0) return 0;

  // Release them first: a lead that finds no eligible agent must end up
  // unassigned, exactly as the per-lead path left it.
  await prisma.lead.updateMany({
    where: { id: { in: leads.map((l) => l.id) } },
    data: { ownerMemberId: null },
  });

  const organizationId = leads[0].organizationId;
  const agents = await prisma.organizationMember.findMany({
    where: { organizationId, role: "AGENT", status: "ACTIVE", id: { not: memberId } },
    include: { _count: { select: { assignedLeads: { where: { mergedIntoLeadId: null } } } } },
  });

  const load = new Map(agents.map((a) => [a.id, a._count.assignedLeads]));
  const batches = new Map<string, string[]>();

  for (const lead of leads) {
    let target: string | null = null;
    let lowest = DEFAULT_AGENT_CAP;
    for (const [id, count] of load) {
      if (count < lowest) {
        lowest = count;
        target = id;
      }
    }
    if (!target) break; // everyone at cap — the rest stay unassigned
    load.set(target, lowest + 1);
    const batch = batches.get(target);
    if (batch) batch.push(lead.id);
    else batches.set(target, [lead.id]);
  }

  await prisma.$transaction(
    [...batches].map(([ownerMemberId, ids]) =>
      prisma.lead.updateMany({ where: { id: { in: ids } }, data: { ownerMemberId } }),
    ),
  );

  return leads.length;
}
