/**
 * The Prisma client.
 *
 * Prisma reaches Postgres either through its own query-engine binary or through
 * a driver adapter. The Workers runtime has no filesystem to load a binary
 * from, so this uses the pg adapter everywhere — one ORM layer, one driver,
 * identical SQL behaviour in tests and in production.
 *
 * The imports below are literal on purpose. An earlier version assembled the
 * module names at runtime to hide `pg` from the Worker bundler, because OpenNext
 * then failed to ship `pg-cloudflare`'s workerd build. That trick passed every
 * unit test — Vitest uses Node's real `require` — and failed every real
 * request: Turbopack compiles `require(expression)` to a stub that throws
 * "Cannot find module as expression is too dynamic", so no query ever ran
 * under `next dev` or `next build`. OpenNext ≥ 1.20 copies the workerd build
 * of traced packages itself, so the reason for hiding the import is gone and
 * the documented setup (pg + @prisma/adapter-pg, both left external in
 * next.config.js) works on Node and on Workers alike.
 *
 * What does differ between the two runtimes is the client's lifetime:
 *
 *   * On Node the client is cached for the life of the process. In development
 *     the module is re-evaluated on each hot reload, and without the cache the
 *     pools accumulate until Postgres refuses new connections.
 *
 *   * On Workers a socket belongs to the request that opened it. A client kept
 *     across requests fails the second one with "Cannot perform I/O on behalf
 *     of a different request". So there the client is scoped to the request's
 *     ExecutionContext and dropped with it. The connection string comes from
 *     the Hyperdrive binding when one is configured — Hyperdrive is the pool
 *     that outlives requests — and from DATABASE_URL otherwise.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

interface CloudflareRequestContext {
  env?: { HYPERDRIVE?: { connectionString?: string } };
  ctx?: object;
}

/**
 * The per-request Cloudflare context, or undefined when not on Workers.
 *
 * Read from the global slot OpenNext publishes it in rather than through
 * `getCloudflareContext()`: that function throws outside a Worker, and
 * importing the adapter package into the Node bundle for one property read is
 * a poor trade. The symbol is part of the adapter's public contract.
 */
function cloudflareContext(): CloudflareRequestContext | undefined {
  return (globalThis as unknown as Record<symbol, unknown>)[Symbol.for("__cloudflare-context__")] as
    CloudflareRequestContext | undefined;
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const perRequest = new WeakMap<object, PrismaClient>();

function build(connectionString: string, max: number): PrismaClient {
  const log: ("warn" | "error")[] = process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"];
  const pool = new Pool({ connectionString, max });
  return new PrismaClient({ adapter: new PrismaPg(pool), log });
}

function client(): PrismaClient {
  const cf = cloudflareContext();

  if (cf?.ctx) {
    let scoped = perRequest.get(cf.ctx);
    if (!scoped) {
      const connectionString = cf.env?.HYPERDRIVE?.connectionString ?? process.env.DATABASE_URL;
      if (!connectionString)
        throw new Error("No database connection string: bind HYPERDRIVE or set DATABASE_URL");
      // Workers caps concurrent outbound connections per request, and the
      // dashboard fires six queries at once — a handful is enough, more risks the cap.
      scoped = build(connectionString, 5);
      perRequest.set(cf.ctx, scoped);
    }
    return scoped;
  }

  if (!globalForPrisma.prisma) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("No database connection string: set DATABASE_URL");
    globalForPrisma.prisma = build(connectionString, 10);
  }
  return globalForPrisma.prisma;
}

/**
 * The connection string is only known inside a request on Workers, so the
 * client is built on first use rather than at import. The Proxy keeps that
 * lazy without touching the ~30 modules that do `import { prisma } from "./db"`.
 */
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    return Reflect.get(client() as object, prop, receiver);
  },
  has(_target, prop) {
    return Reflect.has(client() as object, prop);
  },
});
