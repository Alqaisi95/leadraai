/**
 * Error reporting. Sends to Sentry when SENTRY_DSN is configured; otherwise
 * writes a structured line to stdout (which Vercel Functions logs already
 * capture), so nothing is silently swallowed on an unconfigured install.
 *
 * Deliberately a thin direct-to-store-endpoint client rather than the full
 * @sentry/nextjs SDK: no build-time instrumentation, no bundle weight on the
 * client, and it cannot break a deploy if the DSN is wrong.
 */

interface Dsn {
  endpoint: string;
  publicKey: string;
}

function parseDsn(raw: string | undefined): Dsn | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const projectId = url.pathname.replace(/^\//, "");
    if (!projectId || !url.username) return null;
    return {
      endpoint: `${url.protocol}//${url.host}/api/${projectId}/store/`,
      publicKey: url.username,
    };
  } catch {
    return null;
  }
}

const dsn = parseDsn(process.env.SENTRY_DSN);

export interface ErrorContext {
  correlationId?: string;
  organizationId?: string;
  route?: string;
  [key: string]: unknown;
}

export function captureError(error: unknown, context: ErrorContext = {}) {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  // always log locally — this is the record of record when no DSN is set
  console.error(JSON.stringify({ level: "error", message, ...context }));

  if (!dsn) return;

  const body = {
    event_id: crypto.randomUUID().replace(/-/g, ""),
    timestamp: new Date().toISOString(),
    platform: "javascript",
    level: "error",
    environment: process.env.NODE_ENV ?? "development",
    server_name: "leadra-api",
    tags: {
      route: context.route,
      organization_id: context.organizationId,
    },
    extra: context,
    exception: {
      values: [
        {
          type: error instanceof Error ? error.name : "Error",
          value: message,
          stacktrace: stack ? { frames: [] } : undefined,
        },
      ],
    },
    message: { formatted: message },
    ...(stack ? { culprit: stack.split("\n")[1]?.trim() } : {}),
  };

  // fire-and-forget: monitoring must never delay or fail a user request
  fetch(dsn.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${dsn.publicKey}, sentry_client=leadra/1.0`,
    },
    body: JSON.stringify(body),
  }).catch(() => {});
}

export const monitoringEnabled = dsn !== null;
