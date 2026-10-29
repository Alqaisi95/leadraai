"use client";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { hasPermission, type Permission, type RoleKey } from "@/lib/rbac";
import { api, getOrg } from "@/lib/client";

type NavItem = { href: string; label: string; perm?: Permission };

const NAV: NavItem[] = [
  { href: "/dashboard", label: "لوحة القيادة" },
  { href: "/inbox", label: "صندوق المحادثات", perm: "conversations.read" },
  { href: "/leads", label: "العملاء والمسار", perm: "leads.read" },
  { href: "/inventory", label: "المشاريع والوحدات", perm: "units.manage" },
  { href: "/knowledge", label: "قاعدة المعرفة", perm: "knowledge.manage" },
  { href: "/team", label: "الفريق", perm: "org.members.manage" },
  { href: "/integrations", label: "التكاملات", perm: "integrations.manage" },
  { href: "/settings", label: "الإعدادات" },
  { href: "/notifications", label: "الإشعارات" },
];

/** Role of the current user in the selected organization (null while loading). */
export function useRole(): RoleKey | null {
  const [role, setRole] = useState<RoleKey | null>(null);
  useEffect(() => {
    const cached = localStorage.getItem("leadra_role") as RoleKey | null;
    if (cached) setRole(cached);
    api("/api/me")
      .then((me) => {
        const m = me.memberships?.find((x: any) => x.organizationId === getOrg()) ?? me.memberships?.[0];
        if (m) {
          localStorage.setItem("leadra_role", m.role);
          setRole(m.role);
        }
      })
      .catch(() => {});
  }, []);
  return role;
}

export function can(role: RoleKey | null, perm: Permission): boolean {
  return !!role && hasPermission(role, perm);
}

export default function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const role = useRole();
  const [open, setOpen] = useState(false);
  const items = NAV.filter((n) => !n.perm || can(role, n.perm));

  async function logout() {
    await fetch("/api/auth/logout", {
      method: "POST",
      headers: { "X-CSRF-Token": document.cookie.match(/leadra_csrf=([^;]*)/)?.[1] ?? "" },
    });
    localStorage.clear();
    window.location.href = "/login";
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="logo">ليدرا <em>AI</em></div>
        <button className="menu-btn" aria-label="القائمة" onClick={() => setOpen(!open)}>☰</button>
      </header>
      <aside className={`sidebar ${open ? "open" : ""}`}>
        <div className="logo desktop-only">ليدرا <em>AI</em></div>
        {items.map((n) => (
          <a key={n.href} href={n.href} className={`nav-item ${path.startsWith(n.href) ? "active" : ""}`}>
            {n.label}
          </a>
        ))}
        <div style={{ flex: 1 }} />
        <button className="nav-item nav-button" onClick={logout}>تسجيل الخروج</button>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
