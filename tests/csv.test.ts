import { describe, it, expect } from "vitest";
import { parseCsv, mapHeaders, toNumber, toStatus } from "@/lib/csv";

/**
 * A CSV bug does not crash — it silently shifts every column, so a price lands
 * in the bedroom count and the import "succeeds". These pin the cases real
 * sheets actually produce: Excel's BOM, CRLF, commas inside quoted Arabic
 * values, escaped quotes, and Arabic-Indic digits.
 */
describe("parseCsv — تحليل الملف", () => {
  it("parses a plain sheet", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("strips Excel's UTF-8 BOM so the first header still matches", () => {
    const [header] = parseCsv("﻿المشروع,الوحدة\nالياسمين,A-101");
    expect(header[0]).toBe("المشروع");
  });

  it("handles CRLF from Windows exports", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("keeps a comma that sits inside a quoted value", () => {
    // the exact case that shifts every later column if mishandled
    const rows = parseCsv('المشروع,الموقع\nالياسمين,"بغداد, المنصور"');
    expect(rows[1]).toEqual(["الياسمين", "بغداد, المنصور"]);
  });

  it("unescapes a doubled quote inside a quoted field", () => {
    expect(parseCsv('a\n"say ""hi"""')).toEqual([["a"], ['say "hi"']]);
  });

  it("keeps a newline inside a quoted field as part of the value", () => {
    const rows = parseCsv('note\n"line1\nline2"');
    expect(rows).toEqual([["note"], ["line1\nline2"]]);
  });

  it("does not emit a phantom record for a trailing newline", () => {
    expect(parseCsv("a,b\n1,2\n")).toHaveLength(2);
  });

  it("preserves empty cells so column positions never shift", () => {
    expect(parseCsv("a,b,c\n1,,3")).toEqual([
      ["a", "b", "c"],
      ["1", "", "3"],
    ]);
  });
});

describe("mapHeaders — مطابقة الأعمدة", () => {
  it("matches Arabic headers", () => {
    const map = mapHeaders(["المشروع", "رقم الوحدة", "السعر"]);
    expect(map).toEqual({ project: 0, unitNumber: 1, price: 2 });
  });

  it("matches English headers case-insensitively", () => {
    const map = mapHeaders(["Project", "UNIT NUMBER", "Price"]);
    expect(map.project).toBe(0);
    expect(map.price).toBe(2);
  });

  it("ignores columns it does not recognise instead of guessing", () => {
    const map = mapHeaders(["المشروع", "ملاحظات المالك", "السعر"]);
    expect(map.project).toBe(0);
    expect(map.price).toBe(2);
    expect(Object.values(map)).not.toContain(1);
  });

  it("keeps the first match when a header repeats", () => {
    expect(mapHeaders(["السعر", "price"]).price).toBe(0);
  });

  it("tolerates surrounding whitespace", () => {
    expect(mapHeaders(["  المشروع  "]).project).toBe(0);
  });
});

describe("toNumber — الأرقام كما تكتب فعلًا", () => {
  it("reads plain and thousands-separated numbers", () => {
    expect(toNumber("95000")).toBe(95000);
    expect(toNumber("95,000")).toBe(95000);
  });

  it("reads Arabic-Indic digits", () => {
    expect(toNumber("٩٥٠٠٠")).toBe(95000);
  });

  it("strips a currency symbol", () => {
    expect(toNumber("125000$")).toBe(125000);
  });

  it("returns null for a blank cell, not zero — absent is not free", () => {
    expect(toNumber("")).toBeNull();
    expect(toNumber(undefined)).toBeNull();
  });

  it("returns NaN for junk so the row can be reported instead of silently zeroed", () => {
    expect(Number.isNaN(toNumber("غير محدد") as number)).toBe(true);
  });
});

describe("toStatus — حالة الوحدة", () => {
  it("accepts Arabic and English spellings", () => {
    expect(toStatus("متاحة")).toBe("AVAILABLE");
    expect(toStatus("مباع")).toBe("SOLD");
    expect(toStatus("Reserved")).toBe("RESERVED");
    expect(toStatus("SOLD")).toBe("SOLD");
  });

  it("treats a blank status as on the market", () => {
    expect(toStatus("")).toBe("AVAILABLE");
    expect(toStatus(undefined)).toBe("AVAILABLE");
  });

  it("rejects an unknown status rather than defaulting it", () => {
    // defaulting here would put a sold unit back on the market
    expect(toStatus("قيد التفاوض")).toBeNull();
  });
});
