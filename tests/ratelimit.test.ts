import { describe, it, expect, vi, beforeEach } from "vitest";

const env: { RL_LOGIN?: { limit: ReturnType<typeof vi.fn> }; RL_API?: unknown } = {};
vi.mock("../src/lib/cf", () => ({ cfEnv: () => env }));

import { checkRateLimit } from "../src/lib/ratelimit";

describe("rate limit", () => {
  beforeEach(() => {
    delete env.RL_LOGIN;
    delete env.RL_API;
  });

  it("uses the Cloudflare binding when present", async () => {
    env.RL_LOGIN = { limit: vi.fn().mockResolvedValue({ success: false }) };
    const r = await checkRateLimit("ip:1.2.3.4", "/api/auth/login");
    expect(r.ok).toBe(false);
    expect(env.RL_LOGIN.limit).toHaveBeenCalledWith({ key: "ip:1.2.3.4" });
  });

  it("falls back to memory without a binding and blocks after the limit", async () => {
    const results = [];
    for (let i = 0; i < 11; i++) results.push(await checkRateLimit("ip:fallback", "/api/auth/login"));
    expect(results.slice(0, 10).every((r) => r.ok)).toBe(true);
    expect(results[10].ok).toBe(false);
  });

  it("falls back to memory when the binding throws", async () => {
    env.RL_LOGIN = { limit: vi.fn().mockRejectedValue(new Error("boom")) };
    const r = await checkRateLimit("ip:throws", "/api/auth/login");
    expect(r.ok).toBe(true);
  });
});
