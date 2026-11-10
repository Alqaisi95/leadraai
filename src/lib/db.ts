/**
 * The Prisma client.
 *
 * Prisma reaches Postgres either through its own query-engine binary or through
 * a driver adapter. The Workers runtime has no filesystem to load a binary
 * from, so this uses an adapter everywhere — one ORM layer, identical SQL
 * behaviour in tests and in production.
 *
 * The transport underneath it has to differ, and the reason is concrete:
 *
 *   * On Workers, @prisma/pg-worker — Prisma's fork of pg that opens sockets
 *     through `cloudflare:sockets`. The connection string comes from the
 *     Hyperdrive binding, which pools across the whole fleet. That is the fix
 *     for the problem the schema already documents: every instance opening its
 *     own pool, and together exhausting Postgres before any one looks slow.
 *
 *   * Everywhere else — local, CI, Vercel — plain pg over node:net, with
 *     DATABASE_URL. CI runs a vanilla Postgres service container, which
 *     pg-worker cannot talk to at all: it has no node:net fallback.
 *
 * Both adapters are @prisma/adapter-pg* at the same version as the client, so
 * the only thing that changes is the socket.
 *
 * The Node transport is loaded through a specifier assembled at runtime. This
 * is deliberate and it is load-bearing. esbuild bundles the Worker for the
 * `workerd` export condition, under which `pg` pulls in `pg-cloudflare` and
 * resolves it to a file OpenNext does not copy into the bundle — so a literal
 * `require("pg")` anywhere in this module fails the Worker build outright,
 * even though that branch never executes on Workers. Hiding the specifier from
 * static analysis keeps the dead branch dead. Both transports are declared
 * dependencies; neither is loaded unless its branch runs.
 */
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/** `require` by a name the bundler cannot fold to a literal. */
function requireAtRuntime(parts: string[]): any {
  const specifier = parts.join("");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(specifier);
}

/** The Hyperdrive connection string, or undefined when not on Workers. */
function hyperdriveConnectionString(): string | undefined {
  try {
    return requireAtRuntime(["@opennextjs", "/cloudflare"]).getCloudflareContext?.()?.env?.HYPERDRIVE
      ?.connectionString;
  } catch {
    return undefined;
  }
}

function createClient(): PrismaClient {
  const log: ("warn" | "error")[] = process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"];

  const hyperdrive = hyperdriveConnectionString();
  if (hyperdrive) {
    const { PrismaPg } = requireAtRuntime(["@prisma", "/adapter-pg-worker"]);
    const { Pool } = requireAtRuntime(["@prisma", "/pg-worker"]);
    // Hyperdrive does the pooling, and Workers caps concurrent outbound
    // connections — a larger pool here buys nothing and risks that cap.
    const pool = new Pool({ connectionString: hyperdrive, max: 5 });
    return new PrismaClient({ adapter: new PrismaPg(pool), log });
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("No database connection string: set DATABASE_URL");

  const { PrismaPg } = requireAtRuntime(["@prisma", "/adapter-pg"]);
  const { Pool } = requireAtRuntime(["p", "g"]);
  const pool = new Pool({ connectionString, max: 10 });
  return new PrismaClient({ adapter: new PrismaPg(pool), log });
}

function client(): PrismaClient {
  // Cached on the global in every environment: in development the module is
  // re-evaluated on each hot reload, and without this the pools accumulate
  // until Postgres refuses new connections.
  if (!globalForPrisma.prisma) globalForPrisma.prisma = createClient();
  return globalForPrisma.prisma;
}

/**
 * The Hyperdrive binding is only readable inside a request, so the client is
 * built on first use rather than at import. The Proxy keeps that lazy without
 * touching the ~30 modules that do `import { prisma } from "./db"`.
 */
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    return Reflect.get(client() as object, prop, receiver);
  },
  has(_target, prop) {
    return Reflect.has(client() as object, prop);
  },
});
