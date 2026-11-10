/**
 * CSV parsing for inventory import.
 *
 * Hand-rolled rather than pulled from npm because the failure modes that matter
 * here are specific: Excel on Arabic Windows writes a UTF-8 BOM and CRLF, users
 * paste values containing commas ("بغداد, المنصور"), and a quoted field may
 * itself contain quotes. Getting those wrong silently shifts every column.
 */

/** RFC 4180 field splitting: quoted fields, escaped quotes, embedded newlines. */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, ""); // Excel's UTF-8 BOM
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    // ignore a trailing blank line rather than emitting an empty record
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'; // "" is a literal quote
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }

    if (ch === '"' && field === "") {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      pushField();
      i++;
      continue;
    }
    if (ch === "\r") {
      // CRLF or a lone CR both end the record
      if (text[i + 1] === "\n") i++;
      pushRow();
      i++;
      continue;
    }
    if (ch === "\n") {
      pushRow();
      i++;
      continue;
    }
    field += ch;
    i++;
  }

  if (field !== "" || row.length > 0) pushRow();
  return rows;
}

/** Canonical column → the header spellings we accept, Arabic and English. */
const HEADERS: Record<string, string[]> = {
  project: ["project", "المشروع", "اسم المشروع"],
  unitNumber: ["unit", "unitnumber", "unit_number", "الوحدة", "رقم الوحدة"],
  floor: ["floor", "الطابق"],
  unitType: ["type", "unittype", "unit_type", "النوع", "نوع الوحدة"],
  bedrooms: ["bedrooms", "beds", "غرف", "غرف النوم", "عدد الغرف"],
  bathrooms: ["bathrooms", "baths", "حمامات", "عدد الحمامات"],
  areaSqm: ["area", "areasqm", "area_sqm", "المساحة", "المساحة م2"],
  price: ["price", "السعر"],
  status: ["status", "الحالة"],
};

function normalizeHeader(h: string) {
  return h
    .trim()
    .toLowerCase()
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[²2]/g, "2")
    .replace(/\s+/g, " ");
}

/** Map the sheet's header row onto our field names; unknown columns are ignored. */
export function mapHeaders(headerRow: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  headerRow.forEach((raw, index) => {
    const h = normalizeHeader(raw);
    for (const [field, aliases] of Object.entries(HEADERS)) {
      if (map[field] === undefined && aliases.some((a) => normalizeHeader(a) === h)) {
        map[field] = index;
      }
    }
  });
  return map;
}

/** Arabic-Indic digits, thousands separators and currency symbols all appear in real sheets. */
export function toNumber(value: string | undefined): number | null {
  if (value === undefined) return null;
  const cleaned = value
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[,٬\s]/g, "")
    .replace(/[$USD﷼د.إ]/gi, "")
    .trim();
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

export const UNIT_STATUSES = [
  "AVAILABLE",
  "TEMP_RESERVED",
  "RESERVED",
  "SOLD",
  "UNAVAILABLE",
  "ON_HOLD",
] as const;

const STATUS_ALIASES: Record<string, (typeof UNIT_STATUSES)[number]> = {
  متاحة: "AVAILABLE",
  متاح: "AVAILABLE",
  available: "AVAILABLE",
  محجوزة: "RESERVED",
  محجوز: "RESERVED",
  reserved: "RESERVED",
  "محجوزة مؤقتا": "TEMP_RESERVED",
  temp_reserved: "TEMP_RESERVED",
  مباعة: "SOLD",
  مباع: "SOLD",
  sold: "SOLD",
  "غير متاحة": "UNAVAILABLE",
  unavailable: "UNAVAILABLE",
  معلقة: "ON_HOLD",
  on_hold: "ON_HOLD",
};

export function toStatus(value: string | undefined): (typeof UNIT_STATUSES)[number] | null {
  if (!value?.trim()) return "AVAILABLE"; // a blank status means the unit is on the market
  const v = value
    .trim()
    .toLowerCase()
    .replace(/[ًٌٍَُِّْ]/g, "");
  if ((UNIT_STATUSES as readonly string[]).includes(v.toUpperCase())) {
    return v.toUpperCase() as (typeof UNIT_STATUSES)[number];
  }
  return STATUS_ALIASES[v] ?? null;
}
