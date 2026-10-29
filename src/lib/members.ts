/**
 * Team management rules. The guard is pure so it can be unit-tested.
 */
import { randomBytes } from "crypto";

export const ASSIGNABLE_ROLES = ["ORG_ADMIN", "SALES_MANAGER", "AGENT", "MARKETING", "VIEWER"] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

export type MemberChange = {
  actorMemberId: string;
  target: { id: string; role: string; status: string };
  nextRole?: string;
  nextStatus?: string;
  /** active ORG_ADMIN members in the organization, including the target */
  activeAdminCount: number;
};

/** Returns an error code, or null when the change is allowed. */
export function memberChangeError(c: MemberChange): string | null {
  const changesRole = c.nextRole !== undefined && c.nextRole !== c.target.role;
  const changesStatus = c.nextStatus !== undefined && c.nextStatus !== c.target.status;
  if (!changesRole && !changesStatus) return null;

  if (c.target.id === c.actorMemberId) return "SELF_CHANGE"; // ask another admin
  if (changesRole && !(ASSIGNABLE_ROLES as readonly string[]).includes(c.nextRole!)) return "INVALID_ROLE";

  const isActiveAdmin = c.target.role === "ORG_ADMIN" && c.target.status === "ACTIVE";
  const losesAdmin = (changesRole && c.nextRole !== "ORG_ADMIN") || (changesStatus && c.nextStatus !== "ACTIVE");
  if (isActiveAdmin && losesAdmin && c.activeAdminCount <= 1) return "LAST_ADMIN";
  return null;
}

export const MEMBER_ERROR_MESSAGE: Record<string, string> = {
  SELF_CHANGE: "لا يمكنك تغيير دورك أو حالتك بنفسك — اطلب ذلك من مدير آخر",
  INVALID_ROLE: "دور غير صالح",
  LAST_ADMIN: "لا بد من بقاء مدير شركة نشط واحد على الأقل",
};

/** Readable temporary password: 14 chars, no look-alike characters. */
export function temporaryPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(14);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}
