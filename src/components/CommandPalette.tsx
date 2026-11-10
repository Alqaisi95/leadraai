"use client";
import { useEffect, useRef, useState } from "react";
import { Building2, MessagesSquare, Search, User } from "lucide-react";
import { api } from "@/lib/client";

type Hit = { href: string; label: string; hint?: string; icon: React.ReactNode };

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setHits([]);
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  useEffect(() => {
    if (!open || q.trim().length < 2) {
      setHits([]);
      return;
    }
    setLoading(true);
    const t = setTimeout(() => {
      api(`/api/search?q=${encodeURIComponent(q.trim())}`)
        .then((d) => {
          const rows: Hit[] = [
            ...d.leads.map((l: any) => ({
              href: `/leads/${l.id}`,
              label: l.fullName ?? l.igUsername ?? "عميل",
              hint: `عميل · درجة ${l.score}${l.phone ? ` · ${l.phone}` : ""}`,
              icon: <User size={14} />,
            })),
            ...d.conversations.map((c: any) => ({
              href: "/inbox",
              label: c.customerName ?? c.customerUsername ?? "محادثة",
              hint: "محادثة",
              icon: <MessagesSquare size={14} />,
            })),
            ...d.units.map((u: any) => ({
              href: "/inventory",
              label: `${u.project} — ${u.unitNumber}`,
              hint: `وحدة${u.price ? ` · ${Number(u.price).toLocaleString()} $` : ""}`,
              icon: <Building2 size={14} />,
            })),
          ];
          setHits(rows);
          setActive(0);
        })
        .catch(() => setHits([]))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(t);
  }, [q, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((a) => Math.min(a + 1, hits.length - 1));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((a) => Math.max(a - 1, 0));
      }
      if (e.key === "Enter" && hits[active]) {
        window.location.href = hits[active].href;
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, hits, active, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center p-4 pt-[12vh]">
      <div className="absolute inset-0 bg-night/50 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative w-full max-w-lg overflow-hidden rounded-card border border-line bg-card shadow-pop">
        <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
          <Search size={16} className="text-dim" />
          <input
            ref={inputRef}
            className="flex-1 bg-transparent text-[14px] outline-none placeholder:text-dim/70"
            placeholder="ابحث عن عميل، محادثة، أو وحدة…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <kbd className="rounded border border-line px-1.5 py-0.5 text-[10px] text-dim">ESC</kbd>
        </div>

        <div className="max-h-80 overflow-y-auto">
          {q.trim().length < 2 && (
            <p className="px-4 py-6 text-center text-[12.5px] text-dim">اكتب حرفين على الأقل للبحث</p>
          )}
          {q.trim().length >= 2 && !loading && hits.length === 0 && (
            <p className="px-4 py-6 text-center text-[12.5px] text-dim">لا نتائج</p>
          )}
          {hits.map((h, i) => (
            <a
              key={`${h.href}-${i}`}
              href={h.href}
              className={`flex items-center gap-3 px-4 py-2.5 text-[13.5px] ${i === active ? "bg-primary-soft" : "hover:bg-primary-soft/50"}`}
              onMouseEnter={() => setActive(i)}
            >
              <span className="text-dim">{h.icon}</span>
              <span className="flex-1 truncate font-medium">{h.label}</span>
              {h.hint && <span className="shrink-0 text-[11.5px] text-dim">{h.hint}</span>}
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
