/** R4.4 — questions AI couldn't answer (low confidence / parse failures). */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api";
import { requirePermission } from "@/lib/rbac";

export const GET = withAuth(async (req, ctx) => {
  requirePermission(ctx.role, "knowledge.manage");
  const days = Math.min(90, Number(new URL(req.url).searchParams.get("days") ?? 14));

  const runs = await prisma.aiRun.findMany({
    where: {
      organizationId: ctx.organizationId,
      runType: "RESPONSE",
      handedOff: true,
      createdAt: { gte: new Date(Date.now() - days * 86_400_000) },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { inputSummary: true, confidence: true, error: true, createdAt: true, conversationId: true },
  });

  // group similar questions crudely by first 40 chars
  const grouped = new Map<string, { question: string; count: number; lastAt: Date; avgConf: number }>();
  for (const r of runs) {
    const q = (r.inputSummary ?? "").trim();
    if (!q) continue;
    const key = q.slice(0, 40);
    const g = grouped.get(key) ?? { question: q, count: 0, lastAt: r.createdAt, avgConf: 0 };
    g.count++;
    g.avgConf += r.confidence ?? 0;
    if (r.createdAt > g.lastAt) g.lastAt = r.createdAt;
    grouped.set(key, g);
  }

  const items = [...grouped.values()]
    .map(g => ({ ...g, avgConf: Number((g.avgConf / g.count).toFixed(2)) }))
    .sort((a, b) => b.count - a.count);

  return NextResponse.json({ periodDays: days, totalHandoffs: runs.length, items });
});
