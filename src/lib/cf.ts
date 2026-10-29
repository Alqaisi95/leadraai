/**
 * Access to Cloudflare bindings from app code. Returns null outside a Worker
 * request (next dev without bindings, tests, the Node worker), so callers can
 * fall back gracefully.
 */
import { getCloudflareContext } from "@opennextjs/cloudflare";

export interface RateLimitBinding {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
}
export interface QueueBinding {
  send(body: unknown): Promise<void>;
}
export interface CfBindings {
  RL_LOGIN?: RateLimitBinding;
  RL_API?: RateLimitBinding;
  WEBHOOK_QUEUE?: QueueBinding;
}

export function cfEnv(): CfBindings | null {
  try {
    return getCloudflareContext().env as unknown as CfBindings;
  } catch {
    return null;
  }
}
