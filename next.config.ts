import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Prisma's generated client must stay external so the Workers bundle picks its wasm engine.
  serverExternalPackages: ["@prisma/client", ".prisma/client"],
};

export default nextConfig;

// Gives `next dev` access to Cloudflare bindings from wrangler.jsonc.
// Dev only: during `next build` several workers would each start a local
// runtime and collide on its storage (SQLITE_BUSY with queues/rate limits).
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
if (process.env.NODE_ENV === "development") initOpenNextCloudflareForDev();
