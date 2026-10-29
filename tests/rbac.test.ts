import { describe, it, expect } from "vitest";
import { hasPermission, requirePermission, ForbiddenError } from "@/lib/rbac";

describe("RBAC matrix (R1)", () => {
  it("agent cannot manage integrations, pipeline, or knowledge", () => {
    expect(hasPermission("AGENT", "integrations.manage")).toBe(false);
    expect(hasPermission("AGENT", "pipeline.manage")).toBe(false);
    expect(hasPermission("AGENT", "knowledge.manage")).toBe(false);
    expect(hasPermission("AGENT", "opportunities.move.any")).toBe(false);
  });
  it("agent can reply and manage own tasks", () => {
    expect(hasPermission("AGENT", "conversations.reply")).toBe(true);
    expect(hasPermission("AGENT", "tasks.manage.own")).toBe(true);
  });
  it("marketing is read-only on leads, no reply", () => {
    expect(hasPermission("MARKETING", "leads.read")).toBe(true);
    expect(hasPermission("MARKETING", "conversations.reply")).toBe(false);
    expect(hasPermission("MARKETING", "leads.update")).toBe(false);
  });
  it("viewer cannot mutate anything", () => {
    expect(hasPermission("VIEWER", "conversations.reply")).toBe(false);
    expect(hasPermission("VIEWER", "leads.update")).toBe(false);
    expect(hasPermission("VIEWER", "units.manage")).toBe(false);
  });
  it("super admin passes everything", () => {
    expect(hasPermission("SUPER_ADMIN", "org.settings.manage")).toBe(true);
  });
  it("requirePermission throws ForbiddenError", () => {
    expect(() => requirePermission("AGENT", "integrations.manage")).toThrow(ForbiddenError);
  });
});
