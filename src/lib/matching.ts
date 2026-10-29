/**
 * Lead ↔ Unit matching with explainable reasons (requirements §4.10).
 * Reads availability ONLY from units.status — the single source of truth.
 */
import { prisma } from "./db";

export interface MatchResult {
  unitId: string;
  unitNumber: string;
  projectName: string;
  price: number | null;
  score: number;
  reasons: string[];
}

export async function matchUnitsForLead(leadId: string, limit = 5): Promise<MatchResult[]> {
  const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });

  const units = await prisma.unit.findMany({
    where: {
      organizationId: lead.organizationId,
      status: "AVAILABLE", // never TEMP_RESERVED/SOLD — §4.9
      ...(lead.interestedProjectId ? { projectId: lead.interestedProjectId } : {}),
    },
    include: { project: { select: { name: true, location: true } } },
    take: 200,
  });

  const budgetMin = lead.budgetMin ? Number(lead.budgetMin) : null;
  const budgetMax = lead.budgetMax ? Number(lead.budgetMax) : null;

  const scored = units.map((u) => {
    let score = 0;
    const reasons: string[] = [];
    const price = u.price ? Number(u.price) : null;

    if (price !== null && (budgetMin !== null || budgetMax !== null)) {
      const min = budgetMin ?? 0;
      const max = budgetMax ?? budgetMin! * 1.2;
      if (price >= min * 0.9 && price <= max * 1.1) { score += 40; reasons.push("ضمن الميزانية"); }
      else if (price <= max * 1.25) { score += 15; reasons.push("قريب من الميزانية"); }
      else { score -= 30; }
    }
    if (lead.area && u.project.location?.includes(lead.area)) { score += 25; reasons.push(`في منطقة ${lead.area}`); }
    if (lead.propertyType && u.unitType === lead.propertyType) { score += 20; reasons.push(`نوع مطلوب: ${u.unitType}`); }
    if (lead.purpose === "INVEST" && u.bedrooms && u.bedrooms <= 2) { score += 5; reasons.push("مناسبة للاستثمار"); }

    return {
      unitId: u.id, unitNumber: u.unitNumber, projectName: u.project.name,
      price, score, reasons,
    };
  });

  return scored
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
