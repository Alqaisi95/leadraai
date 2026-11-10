import type { ReactNode } from "react";

type Tone = "neutral" | "primary" | "warn" | "danger" | "info";

const TONES: Record<Tone, string> = {
  neutral: "bg-line/50 text-dim",
  primary: "bg-primary-soft text-primary",
  warn: "bg-warn-soft text-warn",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
};

export function Badge({
  tone = "neutral",
  className = "",
  children,
}: {
  tone?: Tone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold ${TONES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/** درجة حرارة العميل */
export function TempBadge({ temperature, score }: { temperature: string; score: number }) {
  const tone = temperature === "SALES_READY" ? "primary" : temperature === "WARM" ? "warn" : "neutral";
  const label = temperature === "SALES_READY" ? "جاهز للبيع" : temperature === "WARM" ? "دافئ" : "بارد";
  return (
    <Badge tone={tone as Tone}>
      {label} · {score}
    </Badge>
  );
}

export const CONV_STATUS: Record<string, { label: string; tone: Tone }> = {
  AI_ACTIVE: { label: "AI نشط", tone: "primary" },
  NEEDS_HUMAN: { label: "يحتاج موظفًا", tone: "danger" },
  ASSIGNED_TO_AGENT: { label: "مخصصة", tone: "info" },
  AGENT_ACTIVE: { label: "موظف نشط", tone: "info" },
  FOLLOW_UP_PENDING: { label: "متابعة", tone: "warn" },
  CLOSED: { label: "مغلقة", tone: "neutral" },
  SPAM: { label: "Spam", tone: "neutral" },
};

export function ConvStatusBadge({ status }: { status: string }) {
  const s = CONV_STATUS[status] ?? { label: status, tone: "neutral" as Tone };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}
