/**
 * POST /api/units/import  (multipart: file=CSV|XLSX, projectId, dryRun=1?)
 * Upserts units by (project, unit number). Status and price changes go through
 * the same history logging as manual edits. dryRun returns the preview only.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth, err } from "@/lib/api";
import { requirePermission } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { readSpreadsheet, parseUnitTable, updateUnitWithHistory, ensureBuilding } from "@/lib/inventory";

const MAX_ROWS = 2000;
const MAX_BYTES = 5 * 1024 * 1024;

export const POST = withAuth(async (req, ctx, correlationId) => {
  requirePermission(ctx.role, "units.manage");
  const form = await req.formData();
  const file = form.get("file");
  const projectId = String(form.get("projectId") ?? "");
  const dryRun = form.get("dryRun") === "1";

  if (!(file instanceof File)) return err(422, "VALIDATION", "file is required", correlationId);
  if (file.size > MAX_BYTES) return err(413, "TOO_LARGE", "الملف أكبر من 5MB", correlationId);
  const project = await prisma.project.findFirst({ where: { id: projectId, organizationId: ctx.organizationId } });
  if (!project) return err(404, "NOT_FOUND", "Project not found", correlationId);

  let table: string[][];
  try {
    table = await readSpreadsheet(file);
  } catch {
    return err(422, "UNSUPPORTED_FILE", "استخدم ملف CSV أو Excel (.xlsx)", correlationId);
  }
  const parsed = parseUnitTable(table);
  if (parsed.rows.length > MAX_ROWS) return err(422, "TOO_MANY_ROWS", `الحد ${MAX_ROWS} وحدة في الملف الواحد`, correlationId);

  const existing = await prisma.unit.findMany({
    where: { projectId, unitNumber: { in: parsed.rows.map((r) => r.unitNumber) } },
  });
  const byNumber = new Map(existing.map((u: any) => [u.unitNumber, u]));

  if (dryRun) {
    return NextResponse.json({
      dryRun: true,
      toCreate: parsed.rows.filter((r) => !byNumber.has(r.unitNumber)).length,
      toUpdate: parsed.rows.filter((r) => byNumber.has(r.unitNumber)).length,
      errors: parsed.errors,
      unknownHeaders: parsed.unknownHeaders,
      sample: parsed.rows.slice(0, 5),
    });
  }

  let created = 0, updated = 0;
  const errors = [...parsed.errors];
  for (const { line, building, ...row } of parsed.rows) {
    try {
      const buildingId = await ensureBuilding(projectId, building);
      const current: any = byNumber.get(row.unitNumber);
      if (current) {
        await updateUnitWithHistory(current.id, current, { ...row, ...(buildingId ? { buildingId } : {}) }, ctx.userId);
        updated++;
      } else {
        const unit = await prisma.unit.create({
          data: { ...row, buildingId, projectId, organizationId: ctx.organizationId },
        });
        await prisma.unitAvailabilityHistory.create({ data: { unitId: unit.id, status: unit.status, changedBy: ctx.userId } });
        if (row.price !== undefined) await prisma.unitPriceHistory.create({ data: { unitId: unit.id, price: row.price, changedBy: ctx.userId } });
        created++;
      }
    } catch (e) {
      errors.push({ line, message: String(e).slice(0, 160) });
    }
  }

  await audit({
    ctx, action: "unit.import", entityType: "project", entityId: projectId,
    after: { file: file.name, created, updated, errors: errors.length }, correlationId,
  });
  return NextResponse.json({ created, updated, errors, unknownHeaders: parsed.unknownHeaders });
});
