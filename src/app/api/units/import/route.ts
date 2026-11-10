/**
 * Bulk unit import from a CSV sheet.
 *
 * Always runs the full validation pass first and reports per-row outcomes, so
 * the operator sees exactly what will happen before anything is written.
 * `commit: false` (the default) is a dry run — nothing touches the database.
 *
 * A partially-applied import is worse than a rejected one: prices and
 * availability here are the single source of truth the AI quotes from, so the
 * write runs inside one transaction and any row-level failure rolls all of it
 * back.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withAuth, err } from "@/lib/api";
import { requirePermission } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { mapHeaders, parseCsv, toNumber, toStatus } from "@/lib/csv";

const MAX_ROWS = 2000;

const schema = z.object({
  csv: z.string().min(1).max(2_000_000),
  /** Fallback when the sheet has no project column. */
  defaultProjectId: z.string().optional(),
  commit: z.boolean().default(false),
  /** Update price/status/details of a unit that already exists, instead of skipping it. */
  updateExisting: z.boolean().default(false),
});

type RowOutcome =
  | {
      row: number;
      action: "create" | "update";
      unitNumber: string;
      project: string;
      price: number | null;
      status: string;
    }
  | { row: number; action: "error"; unitNumber: string; reason: string };

export const POST = withAuth(async (req, ctx, correlationId) => {
  requirePermission(ctx.role, "units.manage");

  const body = schema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) return err(422, "VALIDATION", "محتوى الملف مطلوب", correlationId);

  const rows = parseCsv(body.data.csv);
  if (rows.length < 2) {
    return err(
      422,
      "EMPTY",
      "الملف لا يحتوي صفوف بيانات (يلزم صف عناوين + صف واحد على الأقل)",
      correlationId,
    );
  }
  if (rows.length - 1 > MAX_ROWS) {
    return err(422, "TOO_MANY_ROWS", `الحد الأقصى ${MAX_ROWS} صف في المرة الواحدة`, correlationId);
  }

  const cols = mapHeaders(rows[0]);
  if (cols.unitNumber === undefined) {
    return err(422, "MISSING_COLUMN", "لم يُعثر على عمود «رقم الوحدة» — تحقق من صف العناوين", correlationId);
  }
  if (cols.project === undefined && !body.data.defaultProjectId) {
    return err(
      422,
      "MISSING_COLUMN",
      "لم يُعثر على عمود «المشروع» — اختر مشروعًا افتراضيًا أو أضف العمود",
      correlationId,
    );
  }

  const projects = await prisma.project.findMany({
    where: { organizationId: ctx.organizationId },
    select: { id: true, name: true },
  });
  const projectByName = new Map(projects.map((p) => [p.name.trim().toLowerCase(), p]));
  const defaultProject = body.data.defaultProjectId
    ? projects.find((p) => p.id === body.data.defaultProjectId)
    : undefined;
  if (body.data.defaultProjectId && !defaultProject) {
    return err(422, "VALIDATION", "المشروع الافتراضي غير موجود", correlationId);
  }

  const existing = await prisma.unit.findMany({
    where: { organizationId: ctx.organizationId },
    select: { id: true, projectId: true, unitNumber: true },
  });
  const existingKey = new Map(existing.map((u) => [`${u.projectId}::${u.unitNumber}`, u.id]));

  const cell = (r: string[], f: string) => (cols[f] === undefined ? undefined : r[cols[f]]?.trim());
  const outcomes: RowOutcome[] = [];
  const creates: any[] = [];
  const updates: { id: string; data: any }[] = [];
  const seenInFile = new Set<string>();

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const lineNo = i + 1; // 1-based, counting the header — matches the spreadsheet
    if (r.every((c) => c.trim() === "")) continue; // blank spacer row

    const unitNumber = cell(r, "unitNumber") ?? "";
    const fail = (reason: string) => outcomes.push({ row: lineNo, action: "error", unitNumber, reason });

    if (!unitNumber) {
      fail("رقم الوحدة فارغ");
      continue;
    }

    const projectName = cell(r, "project");
    const project = projectName ? projectByName.get(projectName.toLowerCase()) : defaultProject;
    if (!project) {
      fail(projectName ? `المشروع «${projectName}» غير موجود` : "لم يُحدَّد مشروع");
      continue;
    }

    const key = `${project.id}::${unitNumber}`;
    if (seenInFile.has(key)) {
      fail("رقم الوحدة مكرر داخل الملف نفسه");
      continue;
    }
    seenInFile.add(key);

    const status = toStatus(cell(r, "status"));
    if (status === null) {
      fail(`حالة غير معروفة: «${cell(r, "status")}»`);
      continue;
    }

    // NaN means the cell had content we could not read — never silently zero it
    const nums: Record<string, number | null> = {};
    let badNumber: string | null = null;
    for (const [field, label] of [
      ["price", "السعر"],
      ["areaSqm", "المساحة"],
      ["bedrooms", "غرف النوم"],
      ["bathrooms", "الحمامات"],
      ["floor", "الطابق"],
    ] as const) {
      const n = toNumber(cell(r, field));
      if (n !== null && Number.isNaN(n)) badNumber = `${label} ليس رقمًا: «${cell(r, field)}»`;
      nums[field] = n;
    }
    if (badNumber) {
      fail(badNumber);
      continue;
    }
    if (nums.price !== null && nums.price! < 0) {
      fail("السعر سالب");
      continue;
    }

    const data = {
      unitType: cell(r, "unitType") || undefined,
      floor: nums.floor ?? undefined,
      bedrooms: nums.bedrooms ?? undefined,
      bathrooms: nums.bathrooms ?? undefined,
      areaSqm: nums.areaSqm ?? undefined,
      price: nums.price ?? undefined,
      status,
    };

    const existingId = existingKey.get(key);
    if (existingId) {
      if (!body.data.updateExisting) {
        fail("الوحدة موجودة مسبقًا — فعّل «تحديث الموجود» لاستبدال بياناتها");
        continue;
      }
      updates.push({ id: existingId, data: { ...data, statusUpdatedAt: new Date() } });
      outcomes.push({
        row: lineNo,
        action: "update",
        unitNumber,
        project: project.name,
        price: nums.price,
        status,
      });
    } else {
      creates.push({ ...data, organizationId: ctx.organizationId, projectId: project.id, unitNumber });
      outcomes.push({
        row: lineNo,
        action: "create",
        unitNumber,
        project: project.name,
        price: nums.price,
        status,
      });
    }
  }

  const summary = {
    total: outcomes.length,
    create: outcomes.filter((o) => o.action === "create").length,
    update: outcomes.filter((o) => o.action === "update").length,
    error: outcomes.filter((o) => o.action === "error").length,
  };

  if (!body.data.commit) {
    return NextResponse.json({ dryRun: true, summary, outcomes });
  }
  if (summary.error > 0) {
    return err(422, "HAS_ERRORS", `الملف يحتوي ${summary.error} صفًا به خطأ — صحّحها أولًا`, correlationId);
  }
  if (summary.create + summary.update === 0) {
    return err(422, "NOTHING_TO_DO", "لا توجد صفوف للاستيراد", correlationId);
  }

  await prisma.$transaction([
    ...(creates.length ? [prisma.unit.createMany({ data: creates })] : []),
    ...updates.map((u) => prisma.unit.update({ where: { id: u.id }, data: u.data })),
  ]);

  await audit({
    ctx,
    action: "unit.import",
    entityType: "unit",
    after: { created: summary.create, updated: summary.update },
    correlationId,
  });

  return NextResponse.json({ dryRun: false, summary, outcomes });
});
