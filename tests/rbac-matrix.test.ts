import { describe, it, expect } from "vitest";
import { hasPermission, requirePermission, ForbiddenError, type RoleKey } from "@/lib/rbac";

/**
 * Guards the exact boundaries the new settings/inventory screens depend on.
 * A regression here silently widens access, so each case is asserted explicitly.
 */
describe("RBAC — حدود الصلاحيات للشاشات الجديدة", () => {
  it("only ORG_ADMIN manages members, scoring rules and audit", () => {
    for (const perm of ["org.members.manage", "scoring.rules.manage", "audit.read"] as const) {
      expect(hasPermission("ORG_ADMIN", perm)).toBe(true);
      for (const role of ["SALES_MANAGER", "AGENT", "MARKETING", "VIEWER"] as RoleKey[]) {
        expect(hasPermission(role, perm)).toBe(false);
      }
    }
  });

  it("only ORG_ADMIN manages inventory and AI knowledge", () => {
    for (const perm of ["units.manage", "projects.manage", "knowledge.manage"] as const) {
      expect(hasPermission("ORG_ADMIN", perm)).toBe(true);
      expect(hasPermission("SALES_MANAGER", perm)).toBe(false);
      expect(hasPermission("AGENT", perm)).toBe(false);
    }
  });

  it("agents can reply and use the AI assist, viewers cannot", () => {
    expect(hasPermission("AGENT", "conversations.reply")).toBe(true);
    expect(hasPermission("MARKETING", "conversations.reply")).toBe(false);
    expect(hasPermission("VIEWER", "conversations.reply")).toBe(false);
  });

  it("every role except MARKETING/VIEWER can own tasks and appointments", () => {
    for (const role of ["ORG_ADMIN", "SALES_MANAGER", "AGENT"] as RoleKey[]) {
      expect(hasPermission(role, "tasks.manage.own")).toBe(true);
      expect(hasPermission(role, "appointments.manage.own")).toBe(true);
    }
    expect(hasPermission("VIEWER", "tasks.manage.own")).toBe(false);
    expect(hasPermission("MARKETING", "appointments.manage.own")).toBe(false);
  });

  it("only managers and above reassign other people's work", () => {
    expect(hasPermission("SALES_MANAGER", "tasks.manage.any")).toBe(true);
    expect(hasPermission("AGENT", "tasks.manage.any")).toBe(false);
    expect(hasPermission("AGENT", "conversations.reassign")).toBe(false);
  });

  it("SUPER_ADMIN bypasses the matrix entirely", () => {
    expect(hasPermission("SUPER_ADMIN", "audit.read")).toBe(true);
    expect(hasPermission("SUPER_ADMIN", "units.manage")).toBe(true);
  });

  it("requirePermission throws ForbiddenError naming the missing permission", () => {
    expect(() => requirePermission("AGENT", "audit.read")).toThrowError(ForbiddenError);
    try {
      requirePermission("AGENT", "audit.read");
    } catch (e) {
      expect(String(e)).toContain("audit.read");
    }
  });
});
