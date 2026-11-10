# Deploying to Cloudflare Workers

The code is ready. What is left needs an authenticated session, which only you can start.

## Prerequisite: Node 22

Wrangler requires Node >= 22 and this machine's default is 20.17.0. Node 22 is
installed keg-only, so it does not touch your default. Prefix any Wrangler or
Cloudflare build command with:

```bash
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
```

## 1. Sign in

```bash
npx wrangler login
```

## 2. Create the Hyperdrive configuration

Hyperdrive pools Postgres connections across the whole fleet. Point it at the
**direct** Neon endpoint, not the pooler — Hyperdrive is the pooler now, and
stacking it on PgBouncer buys nothing while making timeouts harder to read.

```bash
npx wrangler hyperdrive create leadra-db --connection-string="$DIRECT_URL"
```

Put the id it prints into `wrangler.jsonc`, replacing `REPLACE_WITH_HYPERDRIVE_ID`.

## 3. Set the secrets

`DATABASE_URL` is **not** needed on Workers: the connection string comes from
the Hyperdrive binding. Everything else the app reads has to be set.

```bash
for k in ANTHROPIC_API_KEY TOKEN_ENCRYPTION_KEY CRON_SECRET \
         META_APP_ID META_APP_SECRET META_WEBHOOK_VERIFY_TOKEN \
         VAPID_PRIVATE_KEY VAPID_SUBJECT SENTRY_DSN \
         SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASS SMTP_FROM; do
  npx wrangler secret put "$k"
done
```

Two are plain vars rather than secrets, because the browser needs them — add
them to a `vars` block in `wrangler.jsonc`, not to `secret put`:
`APP_URL` and `NEXT_PUBLIC_VAPID_PUBLIC_KEY`.

> `NEXT_PUBLIC_*` values are inlined at build time, so `NEXT_PUBLIC_VAPID_PUBLIC_KEY`
> must also be present in the environment that runs `cf:build`. A secret set
> after the build will not appear in the client bundle.

## 4. Deploy

```bash
export PATH="/opt/homebrew/opt/node@22/bin:$PATH" && npm run cf:deploy
```

Preview it in the Workers runtime first if you want a look before it goes out:

```bash
export PATH="/opt/homebrew/opt/node@22/bin:$PATH" && npm run cf:preview
```

## 5. Verify, by the only evidence that counts

The crons are the honest test — they are what proved the live site was running
two-month-old code. After a day, check that all three of the jobs added in this
branch have run:

```sql
select name, status, max(started_at)
from job_runs
where started_at > now() - interval '2 days'
group by name, status
order by 3 desc;
```

`followUpSequences`, `scheduledReports` and `rateLimitCleanup` appearing with
status `OK` is the proof. Until they do, the deployment has not taken.

## Notes

- **SMTP will not work on Workers.** `nodemailer` opens raw TCP for SMTP and
  Workers does not offer it. Four finished features depend on mail — password
  reset, email verification, team invites, scheduled reports — so moving to an
  HTTP email API is a blocker for them, not a nice-to-have. Cloudflare's own
  Email Sending is one option and would also satisfy the Workers constraint.
- **`exceljs` is untested on Workers.** It is loaded through a dynamic import
  with a CSV fallback, so the worst case is reports arriving as CSV rather than
  failing. Worth confirming after the first deploy.
- **Vercel is untouched.** `vercel.json` and the `vercel-build` script still
  work, so the current deployment keeps running until you choose to cut over.
- **`maxDuration = 60`** on the two worker routes is a Vercel setting. Workers
  has its own CPU limits instead; the value is inert here, not honoured.
