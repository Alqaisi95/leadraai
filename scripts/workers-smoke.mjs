/**
 * Smoke test for the Worker build, run by CI against `wrangler dev`.
 *
 * Deliberately small. It is not here to test features — the unit and E2E
 * suites do that on Node — but to prove the three things that only break on
 * Workers: that a query runs at all (Prisma's wasm engine + pg over
 * cloudflare:sockets), that a *second* request also gets one (a client cached
 * across requests fails exactly there), and that a route doing real work —
 * bcrypt, several queries, a write — completes inside the runtime's limits.
 */
const base = process.argv[2] ?? "http://127.0.0.1:8787";

async function check(name, fn) {
  try {
    await fn();
    console.log(`ok    ${name}`);
  } catch (e) {
    console.error(`FAIL  ${name}: ${e.message}`);
    process.exitCode = 1;
  }
}

async function health() {
  const res = await fetch(`${base}/api/health`);
  const body = await res.json().catch(() => ({}));
  if (res.status !== 200 || body.status !== "ok") {
    throw new Error(`expected 200 {status:"ok"}, got ${res.status} ${JSON.stringify(body)}`);
  }
}

await check("health — first request reaches Postgres", health);
await check("health — second request gets its own connection", health);
await check("health — third, after the first two have finished", health);

await check("login — seeded admin signs in", async () => {
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "admin@demo.leadra.ai", password: "Leadra@2026!" }),
  });
  const text = await res.text();
  if (res.status !== 200) throw new Error(`expected 200, got ${res.status} ${text.slice(0, 300)}`);
  if (!res.headers.get("set-cookie")) throw new Error("no session cookie set");
});

await check("login — wrong password is a 401, not a 500", async () => {
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "admin@demo.leadra.ai", password: "definitely-wrong" }),
  });
  if (res.status !== 401) throw new Error(`expected 401, got ${res.status}`);
});

await check("cron — drain endpoint runs with the cron secret", async () => {
  const res = await fetch(`${base}/api/worker/drain`, {
    headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
  });
  if (res.status !== 200)
    throw new Error(`expected 200, got ${res.status} ${(await res.text()).slice(0, 300)}`);
});
