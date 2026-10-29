/**
 * Inventory helpers: unit validation, history-aware updates, and bulk import
 * parsing (CSV / XLSX). Parsing is pure so it can be unit-tested.
 */
import { z } from "zod";
import { prisma } from "./db";

export const UNIT_STATUSES = ["AVAILABLE", "TEMP_RESERVED", "RESERVED", "SOLD", "UNAVAILABLE", "ON_HOLD"] as const;
export type UnitStatus = (typeof UNIT_STATUSES)[number];

const num = z.preprocess((v) => (v === "" || v === null || v === undefined ? undefined : Number(v)), z.number().finite().optional());
const int = z.preprocess((v) => (v === "" || v === null || v === undefined ? undefined : Number(v)), z.number().int().optional());
const str = (max: number) => z.preprocess((v) => (v === "" || v === null ? undefined : v), z.string().max(max).optional());

export const unitInputSchema = z.object({
  unitNumber: z.string().trim().min(1).max(50),
  buildingId: str(40),
  floor: int,
  unitType: str(60),
  bedrooms: int,
  bathrooms: int,
  areaSqm: num,
  price: num.refine((v) => v === undefined || v >= 0, "price must be ≥ 0"),
  status: z.enum(UNIT_STATUSES).optional(),
  notes: str(2000),
});
export type UnitInput = z.infer<typeof unitInputSchema>;

/** Find a building by name inside a project, creating it if needed. */
export async function ensureBuilding(projectId: string, name: string | undefined): Promise<string | undefined> {
  const clean = name?.trim();
  if (!clean) return undefined;
  const existing = await prisma.building.findFirst({ where: { projectId, name: clean } });
  if (existing) return existing.id;
  return (await prisma.building.create({ data: { projectId, name: clean } })).id;
}

/**
 * Update a unit and record status/price history in the same transaction.
 * `units.status` stays the single source of truth the AI reads.
 */
export async function updateUnitWithHistory(
  unitId: string,
  before: { status: string; price: unknown },
  data: Partial<UnitInput>,
  changedBy: string,
) {
  const statusChanged = data.status !== undefined && data.status !== before.status;
  const priceChanged =
    data.price !== undefined && (before.price === null || Number(before.price) !== Number(data.price));

  const ops: any[] = [
    prisma.unit.update({
      where: { id: unitId },
      data: { ...data, ...(statusChanged ? { statusUpdatedAt: new Date() } : {}) },
    }),
  ];
  if (statusChanged) ops.push(prisma.unitAvailabilityHistory.create({ data: { unitId, status: data.status as UnitStatus, changedBy } }));
  if (priceChanged) ops.push(prisma.unitPriceHistory.create({ data: { unitId, price: data.price as number, changedBy } }));
  const [updated] = await prisma.$transaction(ops);
  return { updated, statusChanged, priceChanged };
}

// ---------------------------------------------------------------------------
// Import parsing
// ---------------------------------------------------------------------------

/** Header aliases (Arabic + English, case/space-insensitive) → unit field. */
const HEADER_ALIASES: Record<string, keyof UnitInput | "building"> = {
  unitnumber: "unitNumber", unit: "unitNumber", "unit no": "unitNumber", "رقم الوحدة": "unitNumber", "الوحدة": "unitNumber",
  building: "building", "المبنى": "building", "العمارة": "building", "البرج": "building",
  floor: "floor", "الطابق": "floor",
  type: "unitType", unittype: "unitType", "النوع": "unitType", "نوع الوحدة": "unitType",
  bedrooms: "bedrooms", beds: "bedrooms", "غرف النوم": "bedrooms", "الغرف": "bedrooms",
  bathrooms: "bathrooms", baths: "bathrooms", "الحمامات": "bathrooms",
  area: "areaSqm", areasqm: "areaSqm", "المساحة": "areaSqm", "المساحة م2": "areaSqm",
  price: "price", "السعر": "price",
  status: "status", "الحالة": "status",
  notes: "notes", "ملاحظات": "notes",
};

const STATUS_ALIASES: Record<string, UnitStatus> = {
  available: "AVAILABLE", "متاحة": "AVAILABLE", "متاح": "AVAILABLE",
  temp_reserved: "TEMP_RESERVED", "محجوزة مؤقتاً": "TEMP_RESERVED", "محجوزة مؤقتا": "TEMP_RESERVED",
  reserved: "RESERVED", "محجوزة": "RESERVED", "محجوز": "RESERVED",
  sold: "SOLD", "مباعة": "SOLD", "مباع": "SOLD",
  unavailable: "UNAVAILABLE", "غير متاحة": "UNAVAILABLE", "غير متاح": "UNAVAILABLE",
  on_hold: "ON_HOLD", "معلقة": "ON_HOLD", "معلّقة": "ON_HOLD",
};

const ARABIC_DIGITS = /[٠-٩]/g;
function normalizeDigits(s: string): string {
  return s.replace(ARABIC_DIGITS, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
}
function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[_\-]+/g, " ").replace(/\s+/g, " ");
}
function headerKey(h: string): keyof UnitInput | "building" | undefined {
  const n = normalizeHeader(h);
  return HEADER_ALIASES[n] ?? HEADER_ALIASES[n.replace(/ /g, "")];
}
function cleanNumber(v: string): string {
  return normalizeDigits(v).replace(/[,\s$]|IQD|USD|د\.ع|دينار|دولار/gi, "");
}

/** Minimal RFC-4180 CSV parser (quotes, escaped quotes, CRLF, BOM). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}

export type ParsedImport = {
  rows: (UnitInput & { building?: string; line: number })[];
  errors: { line: number; message: string }[];
  unknownHeaders: string[];
};

/** Turn a header row + data rows into validated unit inputs. */
export function parseUnitTable(table: string[][]): ParsedImport {
  const result: ParsedImport = { rows: [], errors: [], unknownHeaders: [] };
  if (table.length === 0) return result;
  const headers = table[0].map((h) => String(h ?? ""));
  const keys = headers.map(headerKey);
  headers.forEach((h, i) => { if (!keys[i] && h.trim()) result.unknownHeaders.push(h.trim()); });
  if (!keys.includes("unitNumber")) {
    result.errors.push({ line: 1, message: "عمود رقم الوحدة غير موجود (unit_number أو رقم الوحدة)" });
    return result;
  }

  for (let r = 1; r < table.length; r++) {
    const line = r + 1;
    const raw: Record<string, string> = {};
    keys.forEach((k, i) => { if (k) raw[k] = String(table[r][i] ?? "").trim(); });
    if (!raw.unitNumber) continue;

    for (const k of ["floor", "bedrooms", "bathrooms", "areaSqm", "price"]) {
      if (raw[k]) raw[k] = cleanNumber(raw[k]);
    }
    if (raw.unitNumber) raw.unitNumber = normalizeDigits(raw.unitNumber);
    let status: UnitStatus | undefined;
    if (raw.status) {
      status = STATUS_ALIASES[raw.status.trim().toLowerCase()] ?? (UNIT_STATUSES as readonly string[]).find((s) => s === raw.status.toUpperCase()) as UnitStatus | undefined;
      if (!status) { result.errors.push({ line, message: `حالة غير معروفة: ${raw.status}` }); continue; }
    }
    const { building, status: _s, ...rest } = raw;
    const parsed = unitInputSchema.safeParse({ ...rest, status });
    if (!parsed.success) {
      result.errors.push({ line, message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("، ") });
      continue;
    }
    result.rows.push({ ...parsed.data, building: building || undefined, line });
  }
  return result;
}

/** Read an uploaded CSV or XLSX file into a string table. */
export async function readSpreadsheet(file: File): Promise<string[][]> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv") || file.type === "text/csv") return parseCsv(await file.text());
  if (name.endsWith(".xlsx")) {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await file.arrayBuffer());
    const ws = wb.worksheets[0];
    if (!ws) return [];
    const out: string[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      for (let c = 1; c <= ws.columnCount; c++) {
        const v: any = row.getCell(c).value;
        cells.push(v === null || v === undefined ? "" : typeof v === "object" ? String(v.result ?? v.text ?? v.richText?.map((t: any) => t.text).join("") ?? "") : String(v));
      }
      out.push(cells);
    });
    return out;
  }
  throw new Error("UNSUPPORTED_FILE");
}

/** CSV template offered for download in the import dialog. */
export const IMPORT_TEMPLATE_CSV =
  "﻿رقم الوحدة,المبنى,الطابق,النوع,غرف النوم,الحمامات,المساحة,السعر,الحالة,ملاحظات\n" +
  "A-101,برج A,1,شقة,2,2,120,95000,متاحة,\n";
