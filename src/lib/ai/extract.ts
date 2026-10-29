/**
 * Text extraction for knowledge-base uploads. Runs on Workers and Node:
 *  - PDF  → unpdf (serverless build of pdf.js)
 *  - DOCX → unzip with fflate, read word/document.xml
 *  - TXT / MD / CSV → read as UTF-8
 * Scanned PDFs (images only) yield no text and are reported as such.
 */
import { unzipSync, strFromU8 } from "fflate";

export type ExtractedType = "PDF" | "DOCX" | "CSV" | "TEXT";

export class ExtractionError extends Error {
  constructor(public code: "UNSUPPORTED_FILE" | "EMPTY_TEXT" | "CORRUPT_FILE", message: string) {
    super(message);
  }
}

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" };

/** Convert the body XML of a .docx into plain text, one paragraph per line. */
export function docxXmlToText(xml: string): string {
  return xml
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<w:br\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(amp|lt|gt|quot|apos);/g, (m) => ENTITIES[m])
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function typeFromName(name: string): ExtractedType | null {
  const n = name.toLowerCase();
  if (n.endsWith(".pdf")) return "PDF";
  if (n.endsWith(".docx")) return "DOCX";
  if (n.endsWith(".csv")) return "CSV";
  if (n.endsWith(".txt") || n.endsWith(".md")) return "TEXT";
  return null;
}

export async function extractText(file: File): Promise<{ type: ExtractedType; text: string; pages?: number }> {
  const type = typeFromName(file.name);
  if (!type) throw new ExtractionError("UNSUPPORTED_FILE", "الصيغ المدعومة: PDF، Word (.docx)، TXT، MD، CSV");
  const bytes = new Uint8Array(await file.arrayBuffer());

  let text = "";
  let pages: number | undefined;
  try {
    if (type === "PDF") {
      const { extractText: pdfText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(bytes);
      const out = await pdfText(pdf, { mergePages: true });
      text = String(out.text ?? "");
      pages = out.totalPages;
    } else if (type === "DOCX") {
      const files = unzipSync(bytes, { filter: (f) => f.name === "word/document.xml" });
      const xml = files["word/document.xml"];
      if (!xml) throw new ExtractionError("CORRUPT_FILE", "ملف Word غير صالح");
      text = docxXmlToText(strFromU8(xml));
    } else {
      text = new TextDecoder("utf-8").decode(bytes).replace(/^﻿/, "");
    }
  } catch (e) {
    if (e instanceof ExtractionError) throw e;
    throw new ExtractionError("CORRUPT_FILE", "تعذّرت قراءة الملف");
  }

  text = text.replace(/\u0000/g, "").trim();
  if (text.length < 10) {
    throw new ExtractionError(
      "EMPTY_TEXT",
      type === "PDF" ? "لا يوجد نص قابل للقراءة — يبدو أن الملف صور ممسوحة ضوئياً" : "الملف لا يحتوي نصاً كافياً",
    );
  }
  return { type, text, pages };
}
