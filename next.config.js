/** @type {import('next').NextConfig} */
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  {
    // Next injects inline bootstrap scripts and styles, hence 'unsafe-inline'.
    // connect-src stays self-only: the app never calls a third-party API from the browser.
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
];

module.exports = {
  // The E2E suite starts its own dev server. Sharing `.next` with a dev server
  // already running on another port makes the two overwrite each other's
  // chunks, and the failures that follow look like application bugs —
  // "Cannot read properties of undefined (reading 'call')" from webpack, or
  // pages that render their shell and no data. Giving each its own directory
  // removes the collision entirely.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Next 16 blocks cross-origin requests for /_next/* assets in dev, where 14
  // only warned. The dev server binds localhost, while Playwright drives it
  // over 127.0.0.1 — a different origin by that rule — so every client chunk
  // came back 403 and the page never hydrated. Dev-only; production is
  // unaffected by this setting.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  // Left to the runtime's own module loader instead of being bundled. Prisma
  // ships a separate build for Workers behind the `workerd` export condition,
  // and pg reaches the network through pg-cloudflare there; bundling either
  // would bake the Node build into the Worker. OpenNext resolves these with
  // the workerd condition when it assembles the Worker, and Node resolves them
  // normally everywhere else. (pg itself is already on Next's built-in list.)
  serverExternalPackages: ["@prisma/client", ".prisma/client", "@prisma/adapter-pg"],
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};
