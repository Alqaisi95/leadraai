/**
 * Append-only audit log. Never update or delete rows from audit_logs.
 * Do NOT put tokens, passwords, or full message bodies in before/after.
 */
import { prisma } from "./db";
import type { TenantContext } from "./tenant";

const REDACT_KEYS = ["password", "passwordHash", "token", "encryptedToken", "mfaSecret", "body"];

/**
 * Callers pass Prisma rows straight in, so `before`/`after` routinely contain
 * values that are objects but must not be walked like one:
 *
 *  - Prisma's Decimal carries an own *enumerable* `constructor` function.
 *    Copying it produced a function inside the Json column, which Prisma
 *    refuses to serialize — the whole request 500'd. Editing any lead with a
 *    budget, or any unit with a price, hit this.
 *  - Date has no own keys at all, so walking it yielded `{}` and every
 *    timestamp was silently logged as an empty object.
 *
 * So: convert known value-objects to primitives, and never recurse into
 * anything that is not a plain object or array.
 */
function toPlain(value: unknown): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function") return undefined; // never loggable
  if (typeof value !== "object") return value;

  if (value instanceof Date) return value.toISOString();
  // The length is read off an explicit cast rather than through the type guard.
  // Buffer.isBuffer narrows reliably only while a single copy of @types/node is
  // in scope, and the Cloudflare toolchain pulls in a second one; the guard then
  // still works at runtime but stops narrowing, and this line fails to compile.
  // The runtime check is unchanged — only the static narrowing is bypassed.
  if (Buffer.isBuffer(value)) return `[${(value as Buffer).length} bytes]`;
  if (Array.isArray(value)) return value.map(toPlain);

  // Decimal and friends expose a numeric/string form — prefer it over the
  // object's internals, which are meaningless in an audit trail.
  const maybe = value as { toJSON?: () => unknown; toNumber?: () => number };
  if (typeof maybe.toNumber === "function") {
    const n = maybe.toNumber();
    return Number.isFinite(n) ? n : String(value);
  }
  if (typeof maybe.toJSON === "function") return toPlain(maybe.toJSON());

  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return String(value);

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => {
      if (REDACT_KEYS.some((r) => k.toLowerCase().includes(r.toLowerCase()))) return [[k, "[REDACTED]"]];
      const plain = toPlain(v);
      return plain === undefined ? [] : [[k, plain]];
    }),
  );
}

export function redactForAudit(value: unknown) {
  return toPlain(value);
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
      before: params.before ? (toPlain(params.before) as object) : undefined,
      after: params.after ? (toPlain(params.after) as object) : undefined,
      ip: params.ip,
      correlationId: params.correlationId,
    },
  });
}
