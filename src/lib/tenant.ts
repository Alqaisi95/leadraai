/**
 * Tenant isolation helpers.
 * Rule: NO query on an operational table without organizationId.
 * All services must go through scoped() to get a tenant-bound context.
 */
import { prisma } from "./db";
import type { RoleKey } from "./rbac";

export interface TenantContext {
  organizationId: string;
  memberId: string;
  userId: string;
  role: RoleKey;
}

export class TenantMismatchError extends Error {
  status = 404; // deliberately 404, not 403 — do not leak existence of other tenants' records
  constructor() {
    super("NOT_FOUND");
  }
}

/**
 * Fetch a record by id AND organizationId. Throws (as 404) if the record
 * exists but belongs to another tenant — this is the cross-tenant guard.
 */
export async function findScopedOrThrow<T>(
  finder: (where: { id: string; organizationId: string }) => Promise<T | null>,
  id: string,
  ctx: TenantContext
): Promise<T> {
  const record = await finder({ id, organizationId: ctx.organizationId });
  if (!record) throw new TenantMismatchError();
  return record;
}

/** Standard scoped where-clause builder */
export function scoped(ctx: TenantContext, extra: Record<string, unknown> = {}) {
  return { organizationId: ctx.organizationId, ...extra };
}

export { prisma };
