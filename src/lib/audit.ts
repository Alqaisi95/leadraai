/**
 * Append-only audit log. Never update or delete rows from audit_logs.
 * Do NOT put tokens, passwords, or full message bodies in before/after.
 */
import { prisma } from "./db";
import type { TenantContext } from "./tenant";

const REDACT_KEYS = ["password", "passwordHash", "token", "encryptedToken", "mfaSecret", "body"];

function redact(obj: unknown): unknown {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(redact);
  return Object.fromEntries(
    Object.entries(obj as Record<string, unknown>).map(([k, v]) =>
      REDACT_KEYS.some((r) => k.toLowerCase().includes(r.toLowerCase()))
        ? [k, "[REDACTED]"]
        : [k, redact(v)]
    )
  );
}

export async function audit(params: {
  ctx?: TenantContext;
  actorUserId?: string;
  action: string;
  entityType?: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  ip?: string;
  correlationId?: string;
}) {
  await prisma.auditLog.create({
    data: {
      organizationId: params.ctx?.organizationId ?? null,
      actorUserId: params.ctx?.userId ?? params.actorUserId ?? null,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      before: params.before ? (redact(params.before) as object) : undefined,
      after: params.after ? (redact(params.after) as object) : undefined,
      ip: params.ip,
      correlationId: params.correlationId,
    },
  });
}
