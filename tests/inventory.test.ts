import { describe, it, expect, vi } from "vitest";
vi.mock("../src/lib/db", () => ({ prisma: {} }));
import { parseCsv, parseUnitTable } from "../src/lib/inventory";

describe("parseCsv", () => {
  it("handles quotes, escaped quotes, CRLF and BOM", () => {
    const rows = parseCsv('﻿a,b\r\n"x, y","he said ""hi"""\r\n\r\n3,4');
    expect(rows).toEqual([["a", "b"], ["x, y", 'he said "hi"'], ["3", "4"]]);
  });
});

describe("parseUnitTable", () => {
  it("maps Arabic headers, Arabic digits, formatted prices and Arabic statuses", () => {
    const r = parseUnitTable([
      ["رقم الوحدة", "المبنى", "الطابق", "غرف النوم", "السعر", "الحالة", "عمود غريب"],
      ["A-١٠١", "برج A", "١", "2", "95,000 $", "محجوزة", "x"],
    ]);
    expect(r.errors).toEqual([]);
    expect(r.unknownHeaders).toEqual(["عمود غريب"]);
    expect(r.rows[0]).toMatchObject({ unitNumber: "A-101", building: "برج A", floor: 1, bedrooms: 2, price: 95000, status: "RESERVED", line: 2 });
  });

  it("accepts English headers and enum statuses", () => {
    const r = parseUnitTable([["unit_number", "area", "status"], ["B2", "120.5", "SOLD"]]);
    expect(r.rows[0]).toMatchObject({ unitNumber: "B2", areaSqm: 120.5, status: "SOLD" });
  });

  it("reports unknown statuses and bad numbers per line, skipping blank unit numbers", () => {
    const r = parseUnitTable([
      ["رقم الوحدة", "السعر", "الحالة"],
      ["1", "abc", ""],
      ["2", "100", "مشطوبة"],
      ["", "100", ""],
    ]);
    expect(r.rows).toHaveLength(0);
    expect(r.errors.map((e) => e.line)).toEqual([2, 3]);
  });

  it("requires a unit number column", () => {
    const r = parseUnitTable([["السعر"], ["100"]]);
    expect(r.errors[0].line).toBe(1);
  });
});
