import { describe, it, expect } from "vitest";
import { cx } from "@/lib/cx";

/**
 * Tailwind resolves conflicts by CSS source order, so a base `w-full` can beat a
 * caller's `w-36` no matter how the class string is ordered. These assertions
 * pin the merge that makes size overrides on the UI kit actually apply.
 */
describe("cx — دمج أصناف Tailwind المتعارضة", () => {
  it("drops the base class when the caller re-specifies its group", () => {
    expect(cx("w-full h-9.5 text-sm", "w-36")).toBe("h-9.5 text-sm w-36");
    expect(cx("w-full h-9.5", "h-8.5")).toBe("w-full h-8.5");
  });

  it("keeps unrelated base classes untouched", () => {
    const out = cx("rounded-field border border-line bg-card px-3", "w-40");
    expect(out).toContain("rounded-field");
    expect(out).toContain("bg-card");
    expect(out).toContain("w-40");
  });

  it("does not let a short group swallow a longer one", () => {
    // `min-w` must not be treated as `m`
    expect(cx("m-2 min-w-52", "min-w-0")).toBe("m-2 min-w-0");
    expect(cx("m-2 min-w-52", "m-4")).toBe("min-w-52 m-4");
  });

  it("treats variants as distinct groups", () => {
    // overriding hover:bg must not strip the base bg
    expect(cx("bg-card hover:bg-primary", "hover:bg-danger")).toBe("bg-card hover:bg-danger");
  });

  it("passes through when nothing conflicts", () => {
    expect(cx("flex gap-2", "shrink-0")).toBe("flex gap-2 shrink-0");
  });

  it("returns the base untouched when no override is given", () => {
    expect(cx("w-full h-9.5")).toBe("w-full h-9.5");
    expect(cx("w-full", "")).toBe("w-full");
  });
});
