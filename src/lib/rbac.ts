/**
 * RBAC — enforced in the server layer, never trusted from the client.
 * Matches roles from the requirements doc §3.
 */

export type RoleKey =
  | "SUPER_ADMIN"
  | "ORG_ADMIN"
  | "SALES_MANAGER"
  | "AGENT"
  | "MARKETING"
  | "VIEWER";

export type Permission =
  // organization
  | "org.settings.manage"
  | "org.members.manage"
  | "org.teams.manage"
  // integrations
  | "integrations.manage"
  // inbox
  | "conversations.read"
  | "conversations.reply"
  | "conversations.reassign"
  // leads & CRM
  | "leads.read"
  | "leads.update"
  | "leads.assign"
  | "pipeline.manage"
  | "opportunities.move"
  | "opportunities.move.any"
  // inventory
  | "projects.manage"
  | "units.manage"
  // AI
  | "ai.settings.manage"
  | "knowledge.manage"
  | "scoring.rules.manage"
  // tasks & appointments
  | "tasks.manage.own"
  | "tasks.manage.any"
  | "appointments.manage.own"
  | "appointments.manage.any"
  // reporting
  | "reports.read.all"
  | "reports.read.team"
  | "reports.read.marketing"
  // audit
  | "audit.read";

const MATRIX: Record<Exclude<RoleKey, "SUPER_ADMIN">, Permission[]> = {
  ORG_ADMIN: [
    "org.settings.manage", "org.members.manage", "org.teams.manage",
    "integrations.manage",
    "conversations.read", "conversations.reply", "conversations.reassign",
    "leads.read", "leads.update", "leads.assign",
    "pipeline.manage", "opportunities.move", "opportunities.move.any",
    "projects.manage", "units.manage",
    "ai.settings.manage", "knowledge.manage", "scoring.rules.manage",
    "tasks.manage.any", "appointments.manage.any",
    "tasks.manage.own", "appointments.manage.own",
    "reports.read.all", "reports.read.team", "reports.read.marketing",
    "audit.read",
  ],
  SALES_MANAGER: [
    "conversations.read", "conversations.reply", "conversations.reassign",
    "leads.read", "leads.update", "leads.assign",
    "pipeline.manage", "opportunities.move", "opportunities.move.any",
    "tasks.manage.any", "appointments.manage.any",
    "tasks.manage.own", "appointments.manage.own",
    "reports.read.team",
  ],
  AGENT: [
    "conversations.read", "conversations.reply",
    "leads.read", "leads.update",
    "opportunities.move", // only within allowed stages — checked in service layer
    "tasks.manage.own", "appointments.manage.own",
  ],
  MARKETING: [
    "conversations.read",
    "leads.read",
    "reports.read.marketing",
  ],
  VIEWER: [
    "leads.read",
    "reports.read.team",
  ],
};

export function hasPermission(role: RoleKey, permission: Permission): boolean {
  if (role === "SUPER_ADMIN") return true; // platform staff — still audited
  return MATRIX[role]?.includes(permission) ?? false;
}

export class ForbiddenError extends Error {
  status = 403;
  constructor(permission: Permission) {
    super(`FORBIDDEN: missing permission ${permission}`);
  }
}

export function requirePermission(role: RoleKey, permission: Permission): void {
  if (!hasPermission(role, permission)) throw new ForbiddenError(permission);
}
