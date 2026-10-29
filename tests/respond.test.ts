import { describe, it, expect, afterEach } from "vitest";
import { draftReply, retrievalQuery, type ModelClient } from "../src/lib/ai/respond";

const inventory = [{ unitNumber: "A-101", project: "النخيل", type: "شقة", bedrooms: 2, areaSqm: "120", price: "95000" }];

function fake(reply: unknown, usage = { input_tokens: 1000, output_tokens: 200 }): ModelClient {
  return {
    messages: {
      create: async () => ({
        content: [{ type: "text", text: typeof reply === "string" ? reply : JSON.stringify(reply) }],
        usage,
      }),
    },
  };
}

const base = { systemPrompt: "sys", history: [{ role: "CUSTOMER", text: "كم سعر الشقة؟" }], knowledgeChunks: [], inventory };
const ok = { reply: "الوحدة A-101 سعرها 95,000", confidence: 0.9, handoff: false, handoff_reason: null, intent: "buy", extracted: {} };

describe("draftReply", () => {
  afterEach(() => {
    delete process.env.AI_PRICE_INPUT_PER_MTOK;
    delete process.env.AI_PRICE_OUTPUT_PER_MTOK;
  });

  it("sends a reply whose prices all come from inventory", async () => {
    const d = await draftReply(base, fake(ok));
    expect(d.decision).toEqual({ handoff: false, reason: null });
    expect(d.usage).toEqual({ input: 1000, output: 200 });
  });

  it("hands off when the model invents a price, including written-out thousands", async () => {
    const d = await draftReply(base, fake({ ...ok, reply: "سعرها ٨٥ ألف دولار" }));
    expect(d.decision).toEqual({ handoff: true, reason: "price_guard" });
  });

  it("hands off on low confidence and on the model's own request", async () => {
    expect((await draftReply(base, fake({ ...ok, confidence: 0.4 }))).decision.reason).toBe("low_confidence");
    expect((await draftReply(base, fake({ ...ok, handoff: true, handoff_reason: "human_requested" }))).decision.reason).toBe("human_requested");
  });

  it("treats unparseable output and API failures as handoffs", async () => {
    expect((await draftReply(base, fake("مرحبا! كيف أساعدك؟"))).decision.reason).toBe("parse_failure");
    const broken: ModelClient = { messages: { create: async () => { throw new Error("overloaded"); } } };
    const d = await draftReply(base, broken);
    expect(d.decision.reason).toBe("ai_failure");
    expect(d.error).toContain("overloaded");
  });

  it("computes cost only when prices are configured", async () => {
    expect((await draftReply(base, fake(ok))).costUsd).toBeNull();
    process.env.AI_PRICE_INPUT_PER_MTOK = "3";
    process.env.AI_PRICE_OUTPUT_PER_MTOK = "15";
    expect((await draftReply(base, fake(ok))).costUsd).toBeCloseTo(0.006, 6);
  });
});

describe("retrievalQuery", () => {
  it("uses the last two customer messages so follow-ups keep their context", () => {
    const q = retrievalQuery([
      { role: "CUSTOMER", text: "مرحبا" },
      { role: "CUSTOMER", text: "عندكم شقق بمشروع النخيل؟" },
      { role: "AI", text: "نعم" },
      { role: "CUSTOMER", text: "وكم المقدم؟" },
    ]);
    expect(q).toBe("عندكم شقق بمشروع النخيل؟ وكم المقدم؟");
  });
});
