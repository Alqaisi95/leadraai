import { describe, it, expect } from "vitest";
import { chunkText } from "@/lib/ai/knowledge";

describe("chunkText — تقطيع مصادر المعرفة", () => {
  it("keeps short text as a single chunk", () => {
    expect(chunkText("مجمع الياسمين في المنصور.")).toEqual(["مجمع الياسمين في المنصور."]);
  });

  it("splits long text on sentence boundaries, not mid-word", () => {
    const sentence = "شقق الغرفتين مساحتها 120 متر مربع وتطل على الحديقة الداخلية. ";
    const chunks = chunkText(sentence.repeat(40), 800);
    expect(chunks.length).toBeGreaterThan(1);
    // no chunk may start mid-word — every chunk begins at a sentence start
    for (const c of chunks) expect(c.startsWith("شقق")).toBe(true);
  });

  it("respects Arabic sentence terminators (؟ and ？)", () => {
    const text = "ما سعر الشقة؟ " + "ا".repeat(900) + ". نهاية.";
    const chunks = chunkText(text, 300);
    expect(chunks[0]).toBe("ما سعر الشقة؟");
  });

  it("drops nothing — concatenated chunks preserve every word", () => {
    const text = "الأولى. الثانية. الثالثة. الرابعة.";
    const words = chunkText(text, 20).join(" ").split(/\s+/).filter(Boolean);
    expect(words).toEqual(["الأولى.", "الثانية.", "الثالثة.", "الرابعة."]);
  });

  it("returns no empty chunks for whitespace-heavy input", () => {
    expect(chunkText("\n\n   \n").filter((c) => c.length === 0)).toHaveLength(0);
  });
});
