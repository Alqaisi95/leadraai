/**
 * Apply pending migrations before a production build on Cloudflare Workers Builds.
 *
 * Workers Builds deploys every push to the production branch as soon as the
 * build finishes. On Vercel, `vercel-build` ran `prisma migrate deploy` first;
 * nothing did that here, so a commit carrying a migration would have put code
 * that expects the new schema in front of a database that does not have it.
 *
 * Runs from `postinstall`, so it needs no change to the build command in the
 * dashboard. It does nothing anywhere except a Workers Builds production
 * build. There it fails closed: with no DIRECT_URL build variable the build
 * stops, and a stopped build leaves the previous version serving — which is
 * the safe outcome. Silently skipping would be the dangerous one.
 *
 * DIRECT_URL must be the direct (non-pooler) endpoint: migrations need a real
 * session, which PgBouncer in transaction mode cannot give them.
 */
import { spawnSync } from "node:child_process";

const productionBranch = process.env.PRODUCTION_BRANCH ?? "main";

if (process.env.WORKERS_CI !== "1" || process.env.WORKERS_CI_BRANCH !== productionBranch) {
  process.exit(0);
}

const directUrl = process.env.DIRECT_URL;
if (!directUrl) {
  console.error(
    [
      "migrate-on-deploy: DIRECT_URL is not set for this build.",
      "Add it under Worker → Settings → Build → Build variables and secrets,",
      "set to the database's direct (non-pooler) connection string.",
      "The build is stopped on purpose: deploying without applying migrations",
      "could put code in front of a schema it does not match.",
    ].join("\n"),
  );
  process.exit(1);
}

const result = spawnSync("npx", ["prisma", "migrate", "deploy"], {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: directUrl, DIRECT_URL: directUrl },
});
process.exit(result.status ?? 1);
