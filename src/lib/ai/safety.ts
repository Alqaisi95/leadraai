/**
 * Code-level safety gates (§4.5): the prompt asks, the code ENFORCES.
 */

const CONFIDENCE_THRESHOLD = 0.65;

export interface AiJson {
  reply: string;
  confidence: number;
  handoff: boolean;
  handoff_reason: string | null;
  intent: string;
  extracted: Record<string, unknown>;
}

export function parseAiJson(raw: string): AiJson | null {
  try {
    const cleaned = raw.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    if (typeof parsed.reply !== "string" || typeof parsed.confidence !== "number") return null;
    return parsed as AiJson;
  } catch {
    return null;
  }
}

/**
 * Gate 1 (v2 — R4.7): price hallucination guard.
 * Normalizes Arabic-Indic digits (٩٥ → 95) and written thousands/millions
 * ("95 ألف" → 95000, "١.٢ مليون" → 1200000) before checking every price-like
 * number against the injected inventory. Unknown price → block & handoff.
 */
const ARABIC_DIGITS: Record<string, string> = { "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9" };

export function normalizePrices(text: string): string {
  let t = text.replace(/[٠-٩]/g, (d) => ARABIC_DIGITS[d]);
  // "95 ألف" / "95 الف" / "95k" → 95000 ; "1.2 مليون" → 1200000
  t = t.replace(/(\d+(?:[.,]\d+)?)\s*(?:ألف|الف|k|K)/g, (_, n) => String(Math.round(parseFloat(n.replace(",", ".")) * 1000)));
  t = t.replace(/(\d+(?:[.,]\d+)?)\s*(?:مليون|م\.|M)/g, (_, n) => String(Math.round(parseFloat(n.replace(",", ".")) * 1_000_000)));
  return t;
}

export function priceGuard(reply: string, allowedPrices: (string | null)[]): boolean {
  const normalized = normalizePrices(reply);
  const priceLike = normalized.match(/\d{1,3}(?:[,.\s]?\d{3})+|\d{4,}/g) ?? [];
  if (priceLike.length === 0) return true;
  const allowed = new Set(
    allowedPrices.filter(Boolean).map((p) => String(p).replace(/[^\d]/g, ""))
  );
  return priceLike.every((n) => {
    const digits = n.replace(/[^\d]/g, "");
    if (digits.length < 4) return true;           // small numbers: areas, rooms
    if (/^20\d{2}$/.test(digits)) return true;    // years
    return allowed.has(digits);
  });
}

export function shouldHandoff(ai: AiJson, priceOk: boolean): { handoff: boolean; reason: string | null } {
  if (!priceOk) return { handoff: true, reason: "price_guard" };
  if (ai.handoff) return { handoff: true, reason: ai.handoff_reason ?? "model_decision" };
  if (ai.confidence < CONFIDENCE_THRESHOLD) return { handoff: true, reason: "low_confidence" };
  if (ai.intent === "complaint") return { handoff: true, reason: "complaint" };
  return { handoff: false, reason: null };
}
