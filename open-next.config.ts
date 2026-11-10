/**
 * OpenNext configuration.
 *
 * Deliberately minimal. The defaults give an in-memory incremental cache,
 * which is the right starting point here: the app is overwhelmingly dynamic
 * per-tenant data behind authentication, so there is little to cache globally,
 * and a KV or R2 cache would add a binding and a failure mode for no gain.
 * Revisit if genuinely static marketing pages are added.
 */
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig();
