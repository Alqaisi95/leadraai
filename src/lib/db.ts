/**
 * Prisma client — works on Cloudflare Workers (via Hyperdrive) and on Node.
 *
 * On Workers, a database connection must not outlive the request that opened it,
 * so we create one client per request (keyed on the request's ExecutionContext)
 * using the `pg` driver adapter. Callers keep importing `prisma` as before — the
 * export is a proxy that resolves to the right client for the current request.
 *
 * On Node (local dev, tests, the standalone worker) a single shared client is used.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { getCloudflareContext } from "@opennextjs/cloudflare";

type Env = { HYPERDRIVE?: { connectionString: string }; DATABASE_URL?: string };

const perRequest = new WeakMap<object, PrismaClient>();
let shared: PrismaClient | undefined;

function makeClient(connectionString: string): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString, max: 1 }),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

function workerContext(): { env: Env; ctx: object } | null {
  try {
    const c = getCloudflareContext();
    return { env: c.env as unknown as Env, ctx: c.ctx as unknown as object };
  } catch {
    return null; // not running inside a Worker request
  }
}

export function getPrisma(): PrismaClient {
  const cf = workerContext();
  if (cf) {
    const url = cf.env.HYPERDRIVE?.connectionString ?? cf.env.DATABASE_URL ?? process.env.DATABASE_URL;
    if (!url) throw new Error("No database configured: add a HYPERDRIVE binding or DATABASE_URL");
    let client = perRequest.get(cf.ctx);
    if (!client) {
      client = makeClient(url);
      perRequest.set(cf.ctx, client);
    }
    return client;
  }
  if (!shared) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    shared = makeClient(url);
  }
  return shared;
}

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getPrisma() as unknown as Record<string | symbol, unknown>;
    const value = client[prop];
    return typeof value === "function" ? (value as Function).bind(client) : value;
  },
});
