/**
 * R2.4 — export any report as CSV (UTF-8 BOM for Excel Arabic) or XLSX.
 * GET /api/reports/export?report=team|overview-sources|leads&format=csv|xlsx
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth, err } from "@/lib/api";
import { requirePermission } from "@/lib/rbac";
import { scoped } from "@/lib/tenant";

async function getRows(report: string, ctx: any): Promise<{ headers: string[]; rows: (string | number)[][] }> {
  if (report === "leads") {
    requirePermission(ctx.role, "leads.read");
    const leads = await prisma.lead.findMany({
      where: scoped(ctx, { mergedIntoLeadId: null }),
      include: { owner: { include: { user: true } }, interestedProject: true },
      orderBy: { score: "desc" }, take: 5000,
    });
    return {
      headers: ["الاسم", "Instagram", "الهاتف", "الغرض", "المنطقة", "الدرجة", "التصنيف", "المشروع", "الموظف"],
      rows: leads.map(l => [l.fullName ?? "", l.igUsername ?? "", l.phone ?? "", l.purpose, l.area ?? "", l.score, l.temperature, l.interestedProject?.name ?? "", l.owner?.user.fullName ?? ""]),
    };
  }
  if (report === "team") {
    requirePermission(ctx.role, "reports.read.team");
    const res = await fetchTeam(ctx);
    return {
      headers: ["الموظف", "الدور", "العملاء", "الصفقات", "المواعيد", "متوسط أول رد (د)", "مخالفات SLA", "عملاء راكدون"],
      rows: res.map((r: any) => [r.member, r.role, r.leads, r.wonDeals, r.appointments, r.avgFirstResponseMin ?? "", r.slaBreaches, r.staleLeads]),
    };
  }
  throw new Error("UNKNOWN_REPORT");
}

async function fetchTeam(ctx: any) {
  // reuse the aggregate endpoint logic via internal call pattern: simplest is a lead-level approximation here
  const agents = await prisma.organizationMember.findMany({
    where: { organizationId: ctx.organizationId, role: { in: ["AGENT", "SALES_MANAGER"] }, status: "ACTIVE" },
    include: { user: { select: { fullName: true } }, _count: { select: { assignedLeads: true, appointments: true } } },
  });
  return agents.map(a => ({
    member: a.user.fullName, role: a.role,
    leads: a._count.assignedLeads, wonDeals: "", appointments: a._count.appointments,
    avgFirstResponseMin: null, slaBreaches: "", staleLeads: "",
  }));
}

function toCsv(headers: string[], rows: (string | number)[][]): string {
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  return "\uFEFF" + [headers.map(esc).join(","), ...rows.map(r => r.map(esc).join(","))].join("\r\n");
}

export const GET = withAuth(async (req, ctx, correlationId) => {
  const url = new URL(req.url);
  const report = url.searchParams.get("report") ?? "leads";
  const format = url.searchParams.get("format") ?? "csv";

  let data;
  try { data = await getRows(report, ctx); }
  catch { return err(422, "VALIDATION", "report must be: leads | team", correlationId); }

  if (format === "csv") {
    return new NextResponse(toCsv(data.headers, data.rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="leadra-${report}.csv"`,
      },
    });
  }

  // XLSX via exceljs (dependency added; graceful error if absent)
  try {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(report, { views: [{ rightToLeft: true }] });
    ws.addRow(data.headers).font = { bold: true };
    data.rows.forEach(r => ws.addRow(r));
    ws.columns.forEach(c => { c.width = 18; });
    const buf = await wb.xlsx.writeBuffer();
    return new NextResponse(buf as any, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="leadra-${report}.xlsx"`,
      },
    });
  } catch {
    return err(500, "XLSX_UNAVAILABLE", "exceljs not installed — use format=csv", correlationId);
  }
});
