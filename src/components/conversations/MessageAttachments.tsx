"use client";
import { Mic, Image as ImageIcon, Video, FileText, Share2, MapPin, Paperclip } from "lucide-react";
import { describeAttachments, type AttachmentKind } from "@/lib/attachments";

const ICON: Record<AttachmentKind, typeof Mic> = {
  audio: Mic,
  image: ImageIcon,
  video: Video,
  file: FileText,
  share: Share2,
  location: MapPin,
  unknown: Paperclip,
};

/**
 * What the customer sent when they did not type.
 *
 * The inbox previously rendered `message.body` and nothing else, so a voice
 * note or a photo produced an empty bubble — the agent could not tell whether
 * the customer had sent something the platform lost, or nothing at all.
 *
 * Playing the media needs a file store this project does not have yet, so this
 * does not pretend to offer one. It states plainly what arrived and that it has
 * to be opened in Instagram. An honest placeholder is worth far more than an
 * empty bubble, and much more than a broken player.
 */
export function MessageAttachments({ raw }: { raw: unknown }) {
  const items = describeAttachments(raw);
  if (items.length === 0) return null;

  return (
    <div className="grid gap-1.5">
      {items.map((a, i) => {
        const Icon = ICON[a.kind];
        return (
          <div
            key={i}
            className="flex items-center gap-2 rounded-field border border-current/15 bg-current/5 px-2.5 py-2"
          >
            <Icon size={15} className="shrink-0 opacity-70" aria-hidden />
            <span className="text-[12.5px] font-medium">{a.label}</span>
          </div>
        );
      })}
      <p className="text-[11px] opacity-70">
        افتح المحادثة في Instagram لعرض المرفق — العرض داخل ليدرا قيد الإعداد.
      </p>
    </div>
  );
}
