/**
 * The email message the Cloudflare binding receives.
 *
 * This is the layer where a mistake is invisible until a real send fails: the
 * binding's field names differ from nodemailer's (`type`, not `contentType`)
 * and from the REST API's (`email`, not `address`), and none of that is caught
 * by the type checker because the binding is typed as unknown off the context.
 *
 * The `from` cases matter because the value arrives as an SMTP-style string,
 * `Leadra AI <no-reply@leadra.ai>`, which the binding will not accept as-is.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildBindingMessage } from "@/lib/email";

const SAVED = { EMAIL_FROM: process.env.EMAIL_FROM, SMTP_FROM: process.env.SMTP_FROM };

describe("buildBindingMessage", () => {
  beforeEach(() => {
    delete process.env.EMAIL_FROM;
    delete process.env.SMTP_FROM;
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(SAVED)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  describe("the sender", () => {
    it("splits a display name off the address", () => {
      process.env.EMAIL_FROM = "Leadra AI <no-reply@leadra.ai>";
      expect(buildBindingMessage("a@b.test", "s", "t").from).toEqual({
        email: "no-reply@leadra.ai",
        name: "Leadra AI",
      });
    });

    it("accepts a bare address", () => {
      process.env.EMAIL_FROM = "no-reply@leadra.ai";
      expect(buildBindingMessage("a@b.test", "s", "t").from).toEqual({
        email: "no-reply@leadra.ai",
      });
    });

    it("leaves no stray whitespace in either part", () => {
      process.env.EMAIL_FROM = "  Leadra AI  <  no-reply@leadra.ai  >  ";
      const { from } = buildBindingMessage("a@b.test", "s", "t");
      expect(from.email.trim()).toBe(from.email);
      expect(from.name?.trim()).toBe(from.name);
    });

    it("reuses SMTP_FROM so a Node deployment needs no second variable", () => {
      process.env.SMTP_FROM = "Leadra <ops@leadra.ai>";
      expect(buildBindingMessage("a@b.test", "s", "t").from.email).toBe("ops@leadra.ai");
    });

    it("prefers EMAIL_FROM when both are set", () => {
      process.env.EMAIL_FROM = "new@leadra.ai";
      process.env.SMTP_FROM = "old@leadra.ai";
      expect(buildBindingMessage("a@b.test", "s", "t").from.email).toBe("new@leadra.ai");
    });

    it("falls back to a parseable default rather than an empty sender", () => {
      // An empty `from` is rejected by the provider, which would turn a
      // missing variable into a send failure instead of a default.
      const { from } = buildBindingMessage("a@b.test", "s", "t");
      expect(from.email).toMatch(/@/);
    });
  });

  describe("attachments", () => {
    const pdf: Parameters<typeof buildBindingMessage>[3] = [
      { filename: "report.pdf", content: Buffer.from("%PDF-1.4"), contentType: "application/pdf" },
    ];

    it("omits the key entirely when there are none", () => {
      expect(buildBindingMessage("a@b.test", "s", "t")).not.toHaveProperty("attachments");
      expect(buildBindingMessage("a@b.test", "s", "t", [])).not.toHaveProperty("attachments");
    });

    it("renames contentType to the binding's `type`", () => {
      const [a] = buildBindingMessage("a@b.test", "s", "t", pdf).attachments!;
      expect(a.type).toBe("application/pdf");
      expect(a).not.toHaveProperty("contentType");
    });

    it("passes the Buffer through untouched", () => {
      // Buffer is a Uint8Array, which is the ArrayBufferView the binding wants.
      // Stringifying it would be sent as raw text, not as the file.
      const [a] = buildBindingMessage("a@b.test", "s", "t", pdf).attachments!;
      expect(Buffer.isBuffer(a.content)).toBe(true);
      expect((a.content as Buffer).toString()).toBe("%PDF-1.4");
    });

    it("marks every attachment as an attachment, not inline", () => {
      // Without a disposition the provider may render it in the body.
      const [a] = buildBindingMessage("a@b.test", "s", "t", pdf).attachments!;
      expect(a.disposition).toBe("attachment");
    });
  });

  it("carries the recipient, subject and body unchanged", () => {
    const m = buildBindingMessage("lead@example.test", "تقرير أسبوعي", "محتوى");
    expect(m.to).toBe("lead@example.test");
    expect(m.subject).toBe("تقرير أسبوعي");
    expect(m.text).toBe("محتوى");
  });
});
