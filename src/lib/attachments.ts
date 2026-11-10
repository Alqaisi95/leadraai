/**
 * Inbound attachments — describing what arrived when it is not text.
 *
 * Meta delivers voice notes, images, videos, files, shared reels and location
 * pins on the same webhook as text. Until now the platform stored the payload
 * and did nothing else with it: `queue.ts` only invoked the assistant when
 * `message.text` was present, and the inbox rendered `message.body` alone. A
 * customer who sent a voice note — the most common way people write in this
 * market — got an empty bubble in front of the agent and total silence back.
 *
 * Fetching, storing and transcribing the media needs a file store this project
 * does not have yet. What does not need one is knowing *that* something
 * arrived, what kind it is, and saying so — to the agent and to the customer.
 * That is what this module is for.
 */

export type AttachmentKind = "audio" | "image" | "video" | "file" | "share" | "location" | "unknown";

export interface DescribedAttachment {
  kind: AttachmentKind;
  /** Arabic noun for one of these, for UI and prompts. */
  label: string;
  /** Meta's temporary URL. Expires — never treat it as storage. */
  sourceUrl?: string;
}

const KIND_BY_META_TYPE: Record<string, AttachmentKind> = {
  audio: "audio",
  image: "image",
  video: "video",
  file: "file",
  share: "share",
  story_mention: "share",
  location: "location",
  fallback: "unknown",
};

const LABEL: Record<AttachmentKind, string> = {
  audio: "رسالة صوتية",
  image: "صورة",
  video: "مقطع فيديو",
  file: "ملف",
  share: "منشور مُشارَك",
  location: "موقع",
  unknown: "مرفق",
};

/**
 * Normalise whatever Meta sent into something the rest of the app can rely on.
 *
 * Deliberately total: an unrecognised type becomes `unknown` rather than being
 * dropped. A message the platform cannot classify still has to be visible —
 * silently discarding it is the bug this module exists to fix.
 */
export function describeAttachments(raw: unknown): DescribedAttachment[] {
  if (!Array.isArray(raw)) return [];

  return raw.flatMap((item): DescribedAttachment[] => {
    if (!item || typeof item !== "object") return [];
    const a = item as { type?: unknown; payload?: { url?: unknown } };
    const kind = KIND_BY_META_TYPE[String(a.type ?? "")] ?? "unknown";
    const url = typeof a.payload?.url === "string" ? a.payload.url : undefined;
    return [{ kind, label: LABEL[kind], sourceUrl: url }];
  });
}

/** Arabic summary of a set of attachments: "رسالة صوتية"، "صورتان"، "٣ مرفقات". */
export function summarizeAttachments(items: DescribedAttachment[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0].label;

  const allSame = items.every((i) => i.kind === items[0].kind);
  if (allSame && items.length === 2) {
    // Arabic has a dual form; "صورتان" reads as written language, "٢ صورة" does not.
    const dual: Partial<Record<AttachmentKind, string>> = {
      image: "صورتان",
      audio: "رسالتان صوتيتان",
      video: "مقطعا فيديو",
      file: "ملفان",
    };
    if (dual[items[0].kind]) return dual[items[0].kind]!;
  }
  return `${items.length} مرفقات`;
}

/**
 * What the assistant is told when the customer sent no text.
 *
 * Phrased as a statement of fact rather than as the customer's words, so the
 * model cannot mistake it for something they typed.
 */
export function attachmentPromptText(items: DescribedAttachment[]): string {
  if (items.length === 0) return "";
  return `[أرسل العميل ${summarizeAttachments(items)} بلا نص]`;
}

/**
 * Whether the assistant can meaningfully answer this on its own.
 *
 * It cannot: nothing here is transcribed or captioned yet, so any reply would
 * be generated without knowing what was actually sent — exactly the kind of
 * confident guess the safety layer exists to prevent. These go to a human.
 */
export function needsHumanForAttachments(items: DescribedAttachment[], hasText: boolean): boolean {
  return !hasText && items.length > 0;
}
