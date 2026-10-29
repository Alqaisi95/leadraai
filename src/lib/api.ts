/**
 * Shared API plumbing (v2): cookie session, CSRF double-submit,
 * rate limiting, correlation IDs, structured errors.
 */
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { resolveContext, SESSION_COOKIE, CSRF_COOKIE } from "./auth";
import type { TenantContext } from "./tenant";
import { ForbiddenError } from "./rbac";
import { TenantMismatchError } from "./tenant";
import { checkRateLimit } from "./ratelimit";

export type Handler = (req: NextRequest, ctx: TenantContext, correlationId: string) => Promise<NextResponse>;

const MUTATING = ["POST", "PUT", "PATCH", "DELETE"];

export function withAuth(handler: Handler) {
  return async (req: NextRequest): Promise<NextResponse> => {
    const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();
    const path = new URL(req.url).pathname;

    // session: cookie first (browser), Bearer fallback (API clients)
    const token =
      req.cookies.get(SESSION_COOKIE)?.value ??
      req.headers.get("authorization")?.replace(/^Bearer /, "") ??
      null;
    const organizationId = req.headers.get("x-organization-id");

    const ctx = await resolveContext(token, organizationId);
    if (!ctx) return err(401, "UNAUTHORIZED", "Invalid or expired session", correlationId);

    // R1.4 — rate limit per user+org
    const rl = checkRateLimit(`u:${ctx.userId}:${ctx.organizationId}`, path);
    if (!rl.ok) {
      const res = err(429, "RATE_LIMITED", "Too many requests", correlationId);
      res.headers.set("X-RateLimit-Limit", String(rl.limit));
      res.headers.set("X-RateLimit-Remaining", "0");
      return res;
    }

    // R1.2 — CSRF double-submit for cookie-authenticated mutations
    const usedCookie = !!req.cookies.get(SESSION_COOKIE)?.value;
    if (usedCookie && MUTATING.includes(req.method)) {
      const headerCsrf = req.headers.get("x-csrf-token");
      const cookieCsrf = req.cookies.get(CSRF_COOKIE)?.value;
      if (!headerCsrf || !cookieCsrf || headerCsrf !== cookieCsrf) {
        return err(403, "CSRF", "CSRF token mismatch", correlationId);
      }
    }

    try {
      const res = await handler(req, ctx, correlationId);
      res.headers.set("x-correlation-id", correlationId);
      res.headers.set("X-RateLimit-Remaining", String(rl.remaining));
      return res;
    } catch (e) {
      if (e instanceof ForbiddenError) return err(403, "FORBIDDEN", e.message, correlationId);
      if (e instanceof TenantMismatchError) return err(404, "NOT_FOUND", "Resource not found", correlationId);
      console.error(JSON.stringify({ correlationId, organizationId: ctx.organizationId, error: String(e) }));
      return err(500, "INTERNAL", "Unexpected error", correlationId);
    }
  };
}

export function err(status: number, code: string, message: string, correlationId: string) {
  return NextResponse.json({ error: { code, message, correlationId } }, { status });
}

export function parsePagination(req: NextRequest) {
  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize") ?? 25)));
  return { skip: (page - 1) * pageSize, take: pageSize, page, pageSize };
}
