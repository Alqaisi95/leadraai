export function LogoMark({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden>
      <rect width="48" height="48" rx="12" fill="#0B1220" />
      <path
        d="M14 37V23c0-6.5 4.5-11 10-11s10 4.5 10 11v14"
        stroke="#4DB3A8"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <circle cx="24" cy="24" r="3.2" fill="#C2703D" />
    </svg>
  );
}

export function Logo({ compact = false, light = false }: { compact?: boolean; light?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <LogoMark />
      {!compact && (
        <span className={`text-lg font-bold tracking-tight ${light ? "text-white" : "text-fg"}`}>
          ليدرا <em className="not-italic text-[#4DB3A8]">AI</em>
        </span>
      )}
    </span>
  );
}
