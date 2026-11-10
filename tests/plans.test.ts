import { describe, expect, it } from "vitest";
import { METRICS, PLANS, getPlan, resolveLimits, selfServePlans, tighterMetrics } from "../src/lib/plans";

describe("catalogue", () => {
  it("only advertises limits something actually measures", () => {
    // the old catalogue promised aiTokens and storageMb that no code counted,
    // so a customer could blow past either and nothing noticed
    const measured = new Set(METRICS.map((m) => m.key));
    for (const p of PLANS) {
      expect(new Set(Object.keys(p.limits))).toEqual(measured);
    }
  });

  it("keeps internal plans out of the self-serve picker", () => {
    const keys = selfServePlans().map((p) => p.key);
    expect(keys).not.toContain("trial");
    expect(keys).not.toContain("enterprise");
    expect(keys).toContain("starter");
  });

  it("prices every self-serve plan", () => {
    for (const p of selfServePlans()) expect(typeof p.priceMonthly).toBe("number");
  });

  it("orders the paid tiers so each is a superset of the one below", () => {
    const tiers = ["starter", "growth", "scale"].map((k) => getPlan(k)!);
    for (let i = 1; i < tiers.length; i++) {
      for (const { key } of METRICS) {
        expect(tiers[i].limits[key]!).toBeGreaterThanOrEqual(tiers[i - 1].limits[key]!);
      }
    }
  });
});

describe("resolveLimits", () => {
  it("lets the stored row win, key by key — that is what grandfathering is", () => {
    const limits = resolveLimits("starter", { users: 99 });
    expect(limits.users).toBe(99);
    expect(limits.monthlyConversations).toBe(getPlan("starter")!.limits.monthlyConversations);
  });

  it("falls back to the plan for a key the row predates", () => {
    expect(resolveLimits("growth", {}).igAccounts).toBe(getPlan("growth")!.limits.igAccounts);
  });

  it("honours an explicit null as unmetered", () => {
    expect(resolveLimits("starter", { monthlyConversations: null }).monthlyConversations).toBeNull();
  });

  it("fails closed on an unknown plan rather than handing out the product", () => {
    const rogue = resolveLimits("free_forever_lol", {});
    expect(rogue).toEqual(getPlan("starter")!.limits);
  });

  it("ignores junk values instead of trusting them", () => {
    const limits = resolveLimits("starter", { users: -5, igAccounts: "many", monthlyAiRuns: NaN });
    expect(limits.users).toBe(getPlan("starter")!.limits.users);
    expect(limits.igAccounts).toBe(getPlan("starter")!.limits.igAccounts);
    expect(limits.monthlyAiRuns).toBe(getPlan("starter")!.limits.monthlyAiRuns);
  });

  it("survives a null limits column", () => {
    expect(resolveLimits("growth", null)).toEqual(getPlan("growth")!.limits);
  });
});

describe("tighterMetrics", () => {
  const starter = getPlan("starter")!.limits;
  const growth = getPlan("growth")!.limits;

  it("names every metric that shrinks on a downgrade", () => {
    expect(tighterMetrics(growth, starter).sort()).toEqual(
      ["igAccounts", "monthlyAiRuns", "monthlyConversations", "users"].sort(),
    );
  });

  it("reports nothing on an upgrade", () => {
    expect(tighterMetrics(starter, growth)).toEqual([]);
  });

  it("treats a move to unmetered as never tighter", () => {
    expect(tighterMetrics(growth, { ...growth, users: null })).toEqual([]);
  });

  it("treats leaving unmetered as tighter", () => {
    expect(tighterMetrics({ ...growth, users: null }, growth)).toEqual(["users"]);
  });
});
