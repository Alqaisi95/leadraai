"use client";
import type { ReactNode } from "react";

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="spread" style={{ marginBottom: 6 }}>
          <h2>{title}</h2>
          <button className="btn sm plain" onClick={onClose} aria-label="إغلاق">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
    </div>
  );
}

export function Notice({ kind, children }: { kind: "ok" | "warn" | "err"; children: ReactNode }) {
  if (!children) return null;
  return <div className={`notice ${kind}`}>{children}</div>;
}

export const UNIT_STATUS_LABEL: Record<string, string> = {
  AVAILABLE: "متاحة",
  TEMP_RESERVED: "محجوزة مؤقتاً",
  RESERVED: "محجوزة",
  SOLD: "مباعة",
  UNAVAILABLE: "غير متاحة",
  ON_HOLD: "معلّقة",
};

export const ROLE_LABEL: Record<string, string> = {
  ORG_ADMIN: "مدير الشركة",
  SALES_MANAGER: "مدير مبيعات",
  AGENT: "موظف مبيعات",
  MARKETING: "تسويق",
  VIEWER: "قراءة فقط",
};

export const MEMBER_STATUS_LABEL: Record<string, string> = {
  ACTIVE: "نشط",
  INVITED: "مدعو",
  SUSPENDED: "موقوف",
};

export const PURPOSE_LABEL: Record<string, string> = {
  BUY: "شراء",
  INVEST: "استثمار",
  RENT: "إيجار",
  UNKNOWN: "غير محدد",
};

export const TEMPERATURE_LABEL: Record<string, string> = {
  COLD: "بارد",
  WARM: "دافئ",
  SALES_READY: "جاهز للبيع",
};

export function money(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString("en-US") : "—";
}

export function dateTime(v: string | Date | null | undefined): string {
  if (!v) return "—";
  return new Date(v).toLocaleString("ar-IQ", { dateStyle: "medium", timeStyle: "short" });
}
