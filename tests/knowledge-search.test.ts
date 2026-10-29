import { describe, it, expect, vi } from "vitest";
vi.mock("../src/lib/db", () => ({ prisma: {} }));
import { normalizeArabic, queryConcepts, rankChunks, chunkText } from "../src/lib/ai/knowledge";

describe("normalizeArabic", () => {
  it("unifies hamza forms, alef maqsura, taa marbuta, tashkeel, tatweel and digits", () => {
    expect(normalizeArabic("الأقسـاط إلى آخر شقّة مُتاحة ٣")).toBe("الاقساط الي اخر شقه متاحه 3");
  });
});

describe("queryConcepts", () => {
  it("drops Iraqi/Gulf filler words and keeps the meaning", () => {
    const c = queryConcepts("هلا اخوي، شنو عدكم شقق بالمنصور؟");
    expect(c.map((x) => x[0])).toEqual(["شقه", "منصور"]);
  });

  it("strips the article and groups installment spellings", () => {
    const a = queryConcepts("كم الأقساط؟");
    const b = queryConcepts("ابي تقسيط");
    expect(a[0]).toEqual(b[0]);
    expect(a[0]).toContain("قسط");
  });

  it("maps 'payment method' to the payment group, not the down-payment group", () => {
    const c = queryConcepts("شنو طريقة الدفع");
    expect(c.find((x) => x.includes("دفع"))).toContain("payment");
    expect(c.some((x) => x.includes("عربون"))).toBe(false);
  });

  it("returns nothing for pure greetings", () => {
    expect(queryConcepts("السلام عليكم مرحبا")).toEqual([]);
  });

  it("handles English questions", () => {
    expect(queryConcepts("What is the price of a villa?").map((x) => x[0])).toEqual(["سعر", "بيت"]);
  });
});

describe("rankChunks", () => {
  const docs = [
    { content: "مواصفات عامة عن المشروع والحدائق", projectId: null },
    { content: "خطة الدفع: مقدّمة 20% والباقي أقساط على 60 شهراً", projectId: "p2" },
    { content: "الأقساط الشهرية تبدأ بعد التسليم. الأقساط بلا فوائد", projectId: "p1" },
  ];

  it("ranks chunks by distinct concepts covered, then prefers the lead's project", () => {
    const ranked = rankChunks(docs, queryConcepts("المقدم والاقساط"), "p1");
    expect(ranked.map((d) => d.content.slice(0, 8))).toEqual(["خطة الدف", "الأقساط "]);
    const forP1 = rankChunks(docs, queryConcepts("الاقساط"), "p1");
    expect(forP1[0].projectId).toBe("p1");
  });

  it("finds text written with different spellings than the question", () => {
    expect(rankChunks(docs, queryConcepts("اقساط"))).toHaveLength(2);
  });
});

describe("chunkText", () => {
  it("hard-splits long text with no sentence breaks", () => {
    const long = Array.from({ length: 400 }, (_, i) => `كلمة${i}`).join(" ");
    const chunks = chunkText(long, 800);
    expect(chunks.length).toBeGreaterThan(3);
    expect(Math.max(...chunks.map((c) => c.length))).toBeLessThanOrEqual(800);
    expect(chunks.join(" ")).toBe(long);
  });

  it("keeps short sentences together", () => {
    expect(chunkText("جملة أولى. جملة ثانية. جملة ثالثة.")).toEqual(["جملة أولى. جملة ثانية. جملة ثالثة."]);
  });
});
