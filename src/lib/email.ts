/**
 * R2.3 — email for critical notifications.
 * Cloudflare Workers can't open raw SMTP connections reliably, so mail goes
 * through Resend's HTTP API (https://resend.com). If RESEND_API_KEY is absent,
 * emails no-op silently and in-app notifications still work.
 */
export async function sendEmail(to: string, subject: string, text: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM ?? "Leadra AI <no-reply@leadra.ai>",
        to: [to],
        subject,
        text,
      }),
    });
    if (!res.ok) {
      console.error("email_failed", res.status, (await res.text()).slice(0, 200));
      return false;
    }
    return true;
  } catch (e) {
    console.error("email_failed", String(e).slice(0, 200));
    return false;
  }
}
