"use client";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const NAV = [
  { href: "/dashboard", label: "لوحة القيادة" },
  { href: "/inbox", label: "صندوق المحادثات" },
  { href: "/leads", label: "العملاء والمسار" },
  { href: "/integrations", label: "التكاملات" },
  { href: "/notifications", label: "الإشعارات" },
];

export default function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="logo">ليدرا <em>AI</em></div>
        {NAV.map((n) => (
          <a key={n.href} href={n.href} className={`nav-item ${path.startsWith(n.href) ? "active" : ""}`}>
            {n.label}
          </a>
        ))}
        <div style={{ flex: 1 }} />
        <button
          className="nav-item"
          style={{ background: "none", border: 0, textAlign: "right", width: "100%" }}
          onClick={async () => { await fetch("/api/auth/logout", { method: "POST", headers: { "X-CSRF-Token": document.cookie.match(/leadra_csrf=([^;]*)/)?.[1] ?? "" } }); localStorage.clear(); window.location.href = "/login"; }}
        >
          تسجيل الخروج
        </button>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
