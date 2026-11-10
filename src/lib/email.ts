/**
 * Outbound email.
 *
 * One function, three transports, chosen by what the runtime actually offers.
 * The reason there is more than one is not taste — it is that SMTP cannot work
 * on Workers at all. nodemailer speaks SMTP over a raw TCP socket, and the
 * Workers runtime has no `node:net`. Left as it was, every feature below would
 * have deployed and then silently failed on first use:
 *
 *   password reset · email verification · team invitations · scheduled reports
 *
 * So:
 *
 *   * **On Workers** — the Cloudflare Email Service binding. No API key, no
 *     socket, no outbound port; `env.EMAIL.send()` hands the message to the
 *     platform. The sending domain has to be onboarded once
 *     (`wrangler email sending enable <domain>`) or the send is rejected.
 *
 *   * **Everywhere else** — local, CI, any Node host — nodemailer over SMTP,
 *     exactly as before, so development and tests need no Cloudflare account.
 *
 *   * **Nothing configured** — return false. Mail is a side effect of these
 *     requests, never the point of them, and in-app notifications still work.
 *     Callers already treat false as "not sent" rather than as an error.
 *
 * Like the database transports in ./db, the Node specifier is assembled at
 * runtime. That is load-bearing: esbuild bundles for the `workerd` condition,
 * under which a literal `import("nodemailer")` drags `node:net` into the
 * bundle and fails the Worker build over a branch that never runs there.
 */

/** `require` by a name the bundler cannot fold to a literal. */
function requireAtRuntime(parts: string[]): any {
  const specifier = parts.join("");
  return require(specifier);
}

/** The Email Service binding, or undefined when not running on Workers. */
function emailBinding(): { send: (msg: unknown) => Promise<unknown> } | undefined {
  try {
    return requireAtRuntime(["@opennextjs", "/cloudflare"]).getCloudflareContext?.()?.env?.EMAIL;
  } catch {
    return undefined;
  }
}

/**
 * Timeouts are not optional on the SMTP path.
 *
 * Without them nodemailer waits on the OS default, which is minutes. An SMTP
 * host that is misconfigured, firewalled, or simply down then holds the request
 * open for the whole of it — the password-reset endpoint stopped responding
 * entirely against an unreachable host.
 */
const SMTP_TIMEOUTS = {
  connectionTimeout: 5_000,
  greetingTimeout: 5_000,
  socketTimeout: 10_000,
};

const DEFAULT_FROM = "Leadra AI <no-reply@leadra.ai>";

export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

/**
 * Accepts both `addr@host` and `Name <addr@host>`, which is what SMTP_FROM
 * holds. Both parts are trimmed: the provider rejects an address with stray
 * whitespace, which would turn a cosmetic slip in an env var into a send
 * failure with nothing in the message to explain it.
 */
function parseFrom(raw: string): { email: string; name?: string } {
  const withName = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(raw);
  if (withName) return { email: withName[2].trim(), name: withName[1].trim() || undefined };
  return { email: raw.trim() };
}

/**
 * The message as the Email Service binding wants it.
 *
 * Split out from the send so it can be tested without a Workers runtime: the
 * field names differ from both nodemailer's and the REST API's (`type` rather
 * than `contentType`, `email` rather than `address`), and getting one wrong
 * fails at the provider rather than at the type checker.
 */
export function buildBindingMessage(
  to: string,
  subject: string,
  text: string,
  attachments?: EmailAttachment[],
) {
  return {
    to,
    from: parseFrom(process.env.EMAIL_FROM ?? process.env.SMTP_FROM ?? DEFAULT_FROM),
    subject,
    text,
    // A Buffer is a Uint8Array, so it satisfies the binding's ArrayBufferView
    // content without a copy. A string would be taken as raw, not base64.
    ...(attachments?.length
      ? {
          attachments: attachments.map((a) => ({
            content: a.content,
            filename: a.filename,
            type: a.contentType,
            disposition: "attachment" as const,
          })),
        }
      : {}),
  };
}

async function sendViaBinding(
  binding: { send: (msg: unknown) => Promise<unknown> },
  to: string,
  subject: string,
  text: string,
  attachments?: EmailAttachment[],
): Promise<boolean> {
  await binding.send(buildBindingMessage(to, subject, text, attachments));
  return true;
}

async function sendViaSmtp(
  to: string,
  subject: string,
  text: string,
  attachments?: EmailAttachment[],
): Promise<boolean> {
  const nodemailer = requireAtRuntime(["node", "mailer"]);
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    ...SMTP_TIMEOUTS,
  });
  await transporter.sendMail({
    from: process.env.SMTP_FROM ?? DEFAULT_FROM,
    to,
    subject,
    text,
    ...(attachments?.length ? { attachments } : {}),
  });
  return true;
}

export async function sendEmail(
  to: string,
  subject: string,
  text: string,
  attachments?: EmailAttachment[],
): Promise<boolean> {
  try {
    const binding = emailBinding();
    if (binding) return await sendViaBinding(binding, to, subject, text, attachments);
    if (process.env.SMTP_HOST) return await sendViaSmtp(to, subject, text, attachments);
    return false;
  } catch (e) {
    console.error("email_failed", String(e).slice(0, 200));
    return false;
  }
}
