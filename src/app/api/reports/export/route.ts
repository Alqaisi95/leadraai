/**
 * R2.4 — export any report as CSV (UTF-8 BOM for Excel Arabic) or XLSX.
 * GET /api/reports/export?report=team|leads&format=csv|xlsx
 *
 * The generation itself lives in lib/reports.ts so the scheduled-delivery job
 * produces byte-identical output — a weekly email that disagrees with the
 * screen would be worse than not sending one.
 */
import { NextResponse } from "next/server";
import { withAuth, err } from "@/lib/api";
import { buildReport, toCsv, toXlsx, UnknownReportError } from "@/lib/reports";

export const GET = withAuth(async (req, ctx, correlationId) => {
  const url = new URL(req.url);
  const report = url.searchParams.get("report") ?? "leads";
  const format = url.searchParams.get("format") ?? "csv";

  let data;
  try {
    data = await buildReport(report, ctx);
  } catch (e) {
    // A permission failure must keep its own 403 rather than being flattened
    // into "unknown report" — the previous version swallowed both alike.
    if (!(e instanceof UnknownReportError)) throw e;
    return err(422, "VALIDATION", "report must be: leads | team", correlationId);
  }

  if (format === "csv") {
    return new NextResponse(toCsv(data), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="leadra-${report}.csv"`,
      },
    });
  }

  try {
    const buf = await toXlsx(report, data);
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
