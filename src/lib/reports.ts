/**
 * Report generation, extracted from the export route.
 *
 * It lived inside the request handler, which was fine while a download was the
 * only way to get a report. Scheduled delivery needs the same output produced
 * without a request, and the one thing that must not happen is a second
 * implementation drifting from the first — a report emailed weekly that
 * disagrees with the screen is worse than no report.
 *
 * The permission checks stay inside `buildReport` rather than at the call
 * sites, so a scheduled run is subject to exactly the same rules as a click.
 */
import { prisma } from "./db";
import { requirePermission } from "./rbac";
import { scoped, type TenantContext } from "./tenant";

export type ReportKey = "leads" | "team";

export const REPORTS: { key: ReportKey; label: string }[] = [
  { key: "leads", label: "العملاء" },
  { key: "team", label: "أداء الفريق" },
];

export interface ReportData {
  headers: string[];
  rows: (string | number)[][];
}

async function fetchTeam(ctx: TenantContext) {
  const agents = await prisma.organizationMember.findMany({
    where: { organizationId: ctx.organizationId, role: { in: ["AGENT", "SALES_MANAGER"] }, status: "ACTIVE" },
    include: {
      user: { select: { fullName: true } },
      _count: { select: { assignedLeads: true, appointments: true } },
    },
  });
  return agents.map((a) => ({
    member: a.user.fullName,
    role: a.role,
    leads: a._count.assignedLeads,
    wonDeals: "",
    appointments: a._count.appointments,
    avgFirstResponseMin: null,
    slaBreaches: "",
    staleLeads: "",
  }));
}

export class UnknownReportError extends Error {
  constructor() {
    super("UNKNOWN_REPORT");
  }
}

/** Rows for a report, with the caller's permissions enforced. */
export async function buildReport(report: string, ctx: TenantContext): Promise<ReportData> {
  if (report === "leads") {
    requirePermission(ctx.role, "leads.read");
    const leads = await prisma.lead.findMany({
      where: scoped(ctx, { mergedIntoLeadId: null }),
      include: { owner: { include: { user: true } }, interestedProject: true },
      orderBy: { score: "desc" },
      take: 5000,
    });
    return {
      headers: ["الاسم", "Instagram", "الهاتف", "الغرض", "المنطقة", "الدرجة", "التصنيف", "المشروع", "الموظف"],
      rows: leads.map((l) => [
        l.fullName ?? "",
        l.igUsername ?? "",
        l.phone ?? "",
        l.purpose,
        l.area ?? "",
        l.score,
        l.temperature,
        l.interestedProject?.name ?? "",
        l.owner?.user.fullName ?? "",
      ]),
    };
  }

  if (report === "team") {
    requirePermission(ctx.role, "reports.read.team");
    const res = await fetchTeam(ctx);
    return {
      headers: [
        "الموظف",
        "الدور",
        "العملاء",
        "الصفقات",
        "المواعيد",
        "متوسط أول رد (د)",
        "مخالفات SLA",
        "عملاء راكدون",
      ],
      rows: res.map((r) => [
        r.member,
        r.role,
        r.leads,
        r.wonDeals,
        r.appointments,
        r.avgFirstResponseMin ?? "",
        r.slaBreaches,
        r.staleLeads,
      ]),
    };
  }

  throw new UnknownReportError();
}

/** CSV with a UTF-8 BOM, which is what makes Excel read Arabic correctly. */
export function toCsv(data: ReportData): string {
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  return "﻿" + [data.headers.map(esc).join(","), ...data.rows.map((r) => r.map(esc).join(","))].join("\r\n");
}

/** XLSX buffer, right-to-left. Throws if exceljs is unavailable. */
export async function toXlsx(report: string, data: ReportData): Promise<Buffer> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(report, { views: [{ rightToLeft: true }] });
  ws.addRow(data.headers).font = { bold: true };
  data.rows.forEach((r) => ws.addRow(r));
  ws.columns.forEach((c) => {
    c.width = 18;
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}
