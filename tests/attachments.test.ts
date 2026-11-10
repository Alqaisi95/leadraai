/**
 * Inbound attachments.
 *
 * The behaviour being pinned down is that nothing arriving from a customer can
 * disappear. Before this, a message with no text was stored and then ignored —
 * no assistant, no escalation, an empty bubble for the agent and silence for
 * the customer. Every case here exists to keep that from coming back.
 */
import { describe, it, expect } from "vitest";
import {
  describeAttachments,
  summarizeAttachments,
  attachmentPromptText,
  needsHumanForAttachments,
} from "@/lib/attachments";

/** The shape Meta actually delivers. */
const meta = (type: string, url = "https://lookaside.fbsbx.com/x") => ({ type, payload: { url } });

describe("describeAttachments", () => {
  it("classifies the types Meta sends", () => {
    const items = describeAttachments([meta("audio"), meta("image"), meta("video"), meta("file")]);
    expect(items.map((i) => i.kind)).toEqual(["audio", "image", "video", "file"]);
    expect(items[0].label).toBe("رسالة صوتية");
  });

  it("maps story mentions to a shared post", () => {
    expect(describeAttachments([meta("story_mention")])[0].kind).toBe("share");
  });

  it("keeps an unrecognised type rather than dropping it", () => {
    // The whole point is that nothing vanishes. A type we have never seen still
    // has to reach the agent as *something*.
    const items = describeAttachments([meta("sticker_wave")]);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("unknown");
    expect(items[0].label).toBe("مرفق");
  });

  it("survives every malformed payload without throwing", () => {
    // This runs on the webhook path, where a throw becomes a 500 and Meta
    // retries the delivery in a loop.
    expect(describeAttachments(undefined)).toEqual([]);
    expect(describeAttachments(null)).toEqual([]);
    expect(describeAttachments("not-an-array")).toEqual([]);
    expect(describeAttachments({})).toEqual([]);
    expect(describeAttachments([null, undefined, 5, "x"])).toEqual([]);
    expect(describeAttachments([{}])).toHaveLength(1);
    expect(describeAttachments([{ type: "audio" }])[0].sourceUrl).toBeUndefined();
  });
});

describe("summarizeAttachments", () => {
  it("names a single attachment", () => {
    expect(summarizeAttachments(describeAttachments([meta("audio")]))).toBe("رسالة صوتية");
  });

  it("uses the Arabic dual for a matched pair", () => {
    // "٢ صورة" is not how the language works; "صورتان" is.
    expect(summarizeAttachments(describeAttachments([meta("image"), meta("image")]))).toBe("صورتان");
  });

  it("counts a mixed or larger set", () => {
    expect(summarizeAttachments(describeAttachments([meta("image"), meta("audio")]))).toBe("2 مرفقات");
    expect(summarizeAttachments(describeAttachments([meta("image"), meta("image"), meta("image")]))).toBe(
      "3 مرفقات",
    );
  });

  it("says nothing when there is nothing", () => {
    expect(summarizeAttachments([])).toBe("");
  });
});

describe("attachmentPromptText", () => {
  it("frames the attachment as a fact, not as the customer's words", () => {
    // The model must not be able to read this as something the customer typed.
    const text = attachmentPromptText(describeAttachments([meta("audio")]));
    expect(text).toContain("أرسل العميل");
    expect(text.startsWith("[")).toBe(true);
    expect(text.endsWith("]")).toBe(true);
  });
});

describe("needsHumanForAttachments", () => {
  it("escalates a message that is only an attachment", () => {
    // Nothing is transcribed, so answering would mean inventing a reply to
    // something we cannot read.
    expect(needsHumanForAttachments(describeAttachments([meta("audio")]), false)).toBe(true);
  });

  it("leaves a message with text to the assistant", () => {
    expect(needsHumanForAttachments(describeAttachments([meta("image")]), true)).toBe(false);
  });

  it("does not escalate a plain text message", () => {
    expect(needsHumanForAttachments([], true)).toBe(false);
    expect(needsHumanForAttachments([], false)).toBe(false);
  });
});
