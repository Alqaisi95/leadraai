import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Prisma's generated client must stay external so the Workers bundle picks its wasm engine.
  serverExternalPackages: ["@prisma/client", ".prisma/client"],
};

export default nextConfig;

// Gives `next dev` access to Cloudflare bindings (Hyperdrive, vars) from wrangler.jsonc.
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();
