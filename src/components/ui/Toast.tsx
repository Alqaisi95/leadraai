"use client";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react";

type ToastKind = "success" | "error" | "warn";
type ToastItem = { id: number; kind: ToastKind; text: string };

const ToastCtx = createContext<(kind: ToastKind, text: string) => void>(() => {});

export function useToast() {
  return useContext(ToastCtx);
}

const ICONS: Record<ToastKind, ReactNode> = {
  success: <CheckCircle2 size={17} className="text-primary shrink-0" />,
  error: <XCircle size={17} className="text-danger shrink-0" />,
  warn: <AlertTriangle size={17} className="text-warn shrink-0" />,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const push = useCallback((kind: ToastKind, text: string) => {
    const id = Date.now() + Math.random();
    setItems((t) => [...t, { id, kind, text }]);
    setTimeout(() => setItems((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);

  return (
    <ToastCtx.Provider value={push}>
      {children}
      {/*
        Toasts are how the app confirms that a save landed or failed. Without a
        live region a screen-reader user gets no confirmation at all — the text
        appears and disappears entirely unannounced. `polite` so it waits for a
        pause rather than cutting across whatever is being read.
      */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed bottom-4 start-1/2 z-[60] flex w-full max-w-sm -translate-x-1/2 flex-col gap-2 px-4 rtl:translate-x-1/2"
      >
        {items.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto flex items-center gap-2.5 rounded-field border border-line bg-card px-4 py-3 text-sm shadow-pop"
          >
            {ICONS[t.kind]}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
