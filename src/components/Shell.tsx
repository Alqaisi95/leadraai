"use client";
import dynamic from "next/dynamic";
import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import {
  Bell,
  BookOpen,
  Building2,
  Cable,
  CalendarDays,
  CheckSquare,
  KanbanSquare,
  LayoutDashboard,
  LogOut,
  MailWarning,
  Menu,
  MessagesSquare,
  Moon,
  PieChart,
  Search,
  Settings,
  Sun,
  X,
} from "lucide-react";
import { Logo } from "@/components/Logo";
import { ToastProvider, useToast } from "@/components/ui/Toast";
import { PushOptIn } from "@/components/PushOptIn";
import { api } from "@/lib/client";

// Reachable only by ⌘K, so it has no business in the first bundle of every page.
const CommandPalette = dynamic(() => import("@/components/CommandPalette").then((m) => m.CommandPalette), {
  ssr: false,
});

const NAV_GROUPS = [
  {
    title: "العمليات",
    items: [
      { href: "/dashboard", label: "لوحة القيادة", icon: LayoutDashboard },
      { href: "/inbox", label: "صندوق المحادثات", icon: MessagesSquare },
      { href: "/leads", label: "العملاء والمسار", icon: KanbanSquare },
    ],
  },
  {
    title: "المتابعة",
    items: [
      { href: "/tasks", label: "المهام", icon: CheckSquare },
      { href: "/appointments", label: "المواعيد", icon: CalendarDays },
    ],
  },
  {
    title: "المخزون والمعرفة",
    items: [
      { href: "/inventory", label: "المخزون العقاري", icon: Building2 },
      { href: "/knowledge", label: "معرفة AI", icon: BookOpen },
    ],
  },
  {
    title: "التحليلات والإعداد",
    items: [
      { href: "/reports", label: "التقارير", icon: PieChart },
      { href: "/integrations", label: "التكاملات", icon: Cable },
      { href: "/settings", label: "الإعدادات", icon: Settings },
    ],
  },
];

function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);
  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("leadra_theme", next ? "dark" : "light");
  }
  return (
    <button
      className="grid size-8 place-items-center rounded-field text-dim transition-colors hover:bg-primary-soft hover:text-primary"
      onClick={toggle}
      aria-label="تبديل المظهر"
    >
      {dark ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}

async function logout() {
  await fetch("/api/auth/logout", {
    method: "POST",
    headers: { "X-CSRF-Token": document.cookie.match(/leadra_csrf=([^;]*)/)?.[1] ?? "" },
  });
  localStorage.clear();
  window.location.href = "/login";
}

/**
 * Live updates: one SSE connection per tab, auto-reconnecting when the server
 * closes it — and disconnected entirely while the tab is hidden.
 *
 * The stream polls the database on a timer, so a tab nobody is looking at costs
 * exactly as much as one being worked in. Forgotten background tabs were the
 * bulk of the standing load, and nothing they receive is worth anything until
 * the operator looks back: the counts are re-fetched on the reconnect.
 */
function useLiveEvents(onUnread: (n: number) => void) {
  useEffect(() => {
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout>;
    let stopped = false;

    function disconnect() {
      clearTimeout(retry);
      source?.close();
      source = null;
    }

    function connect() {
      if (stopped || source || document.visibilityState === "hidden") return;
      const org = localStorage.getItem("leadra_org");
      if (!org) return;
      source = new EventSource(`/api/events?org=${encodeURIComponent(org)}`);
      source.addEventListener("unread", (e) => {
        try {
          onUnread(JSON.parse((e as MessageEvent).data).count);
        } catch {}
      });
      source.addEventListener("messages", (e) => {
        try {
          const { items } = JSON.parse((e as MessageEvent).data);
          if (items?.length) window.dispatchEvent(new CustomEvent("leadra:messages", { detail: items }));
        } catch {}
      });
      source.onerror = () => {
        disconnect();
        if (!stopped) retry = setTimeout(connect, 3000);
      };
    }

    function onVisibility() {
      if (document.visibilityState === "hidden") disconnect();
      else connect();
    }

    connect();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisibility);
      disconnect();
    };
  }, [onUnread]);
}

/**
 * Prompt to confirm the address. Deliberately a bar and not a modal: an
 * unverified account is fully usable, and blocking the screen over a step that
 * only gates two actions would be a bigger interruption than the thing warrants.
 */
function VerifyEmailBar({ email }: { email: string }) {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const toast = useToast();

  async function resend() {
    setSending(true);
    try {
      await api("/api/auth/verify/resend", { method: "POST" });
      setSent(true);
      toast("success", "أرسلنا رابط التأكيد من جديد");
    } catch {
      toast("error", "تعذّر الإرسال — حاول بعد قليل");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-warn/30 bg-warn/10 px-4 py-2 text-[12.5px] md:px-7">
      <MailWarning size={15} className="shrink-0 text-warn" />
      <span>
        أكّد{" "}
        <span dir="ltr" className="font-medium">
          {email}
        </span>{" "}
        لتفعيل ربط Instagram ودعوة الفريق.
      </span>
      <button
        onClick={resend}
        disabled={sending || sent}
        className="font-semibold text-primary underline-offset-2 hover:underline disabled:opacity-50 disabled:no-underline"
      >
        {sent ? "تم الإرسال" : sending ? "جارٍ الإرسال…" : "إعادة إرسال الرابط"}
      </button>
    </div>
  );
}

export default function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [palette, setPalette] = useState(false);
  const [me, setMe] = useState<any>(null);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    api("/api/me")
      .then(setMe)
      .catch(() => {});
    api("/api/notifications")
      .then((d) => setUnread(d.unread))
      .catch(() => {});
  }, []);
  useEffect(() => setOpen(false), [path]);
  useLiveEvents(setUnread);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const sidebar = (
    <aside className="flex h-full w-60 shrink-0 flex-col overflow-y-auto bg-sidebar p-4 text-sidebar-fg">
      <div className="px-1.5 pb-5 pt-1">
        <Logo light />
      </div>

      {NAV_GROUPS.map((group) => (
        <div key={group.title} className="mb-3">
          <div className="px-3 pb-1.5 text-[10.5px] font-bold uppercase tracking-wide opacity-40">
            {group.title}
          </div>
          {group.items.map((n) => {
            const active = path.startsWith(n.href);
            const Icon = n.icon;
            return (
              <a
                key={n.href}
                href={n.href}
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] font-medium transition-colors ${
                  active ? "bg-sidebar-active text-white" : "hover:bg-white/5 hover:text-white"
                }`}
              >
                <Icon size={16} className={active ? "" : "opacity-70"} />
                {n.label}
              </a>
            );
          })}
        </div>
      ))}

      <div className="flex-1" />
      {me?.user && (
        <div className="border-t border-white/10 px-3 pb-1 pt-3 text-[12px]">
          <div className="font-semibold text-white">{me.user.fullName}</div>
          <div className="mt-0.5 truncate opacity-60" dir="ltr">
            {me.user.email}
          </div>
        </div>
      )}
      <button
        className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-start text-[13.5px] font-medium transition-colors hover:bg-white/5 hover:text-white"
        onClick={logout}
      >
        <LogOut size={16} className="opacity-70" />
        تسجيل الخروج
      </button>
    </aside>
  );

  return (
    <ToastProvider>
      <div className="flex min-h-dvh">
        <div className="sticky top-0 hidden h-dvh md:block">{sidebar}</div>

        {open && (
          <div className="fixed inset-0 z-40 md:hidden">
            <div className="absolute inset-0 bg-night/60" onClick={() => setOpen(false)} />
            <div className="absolute inset-y-0 start-0">{sidebar}</div>
            <button
              className="absolute end-4 top-4 grid size-9 place-items-center rounded-full bg-card text-fg shadow-pop"
              onClick={() => setOpen(false)}
              aria-label="إغلاق القائمة"
            >
              <X size={17} />
            </button>
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-13 items-center gap-2 border-b border-line bg-background/85 px-4 backdrop-blur md:px-7">
            <button
              className="grid size-8 place-items-center rounded-field text-dim hover:bg-primary-soft hover:text-primary md:hidden"
              onClick={() => setOpen(true)}
              aria-label="القائمة"
            >
              <Menu size={17} />
            </button>

            <button
              className="flex h-8 items-center gap-2 rounded-field border border-line bg-card px-3 text-[12.5px] text-dim transition-colors hover:border-primary hover:text-primary"
              onClick={() => setPalette(true)}
            >
              <Search size={14} />
              <span className="hidden sm:inline">بحث</span>
              <kbd className="hidden rounded border border-line px-1 text-[10px] sm:inline">⌘K</kbd>
            </button>

            <div className="flex-1" />
            <a
              href="/notifications"
              className="relative grid size-8 place-items-center rounded-field text-dim transition-colors hover:bg-primary-soft hover:text-primary"
              aria-label="الإشعارات"
            >
              <Bell size={16} />
              {unread > 0 && (
                <span className="absolute -end-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-copper px-1 text-[9.5px] font-bold leading-4 text-white">
                  {unread > 9 ? "+9" : unread}
                </span>
              )}
            </a>
            <ThemeToggle />
          </header>

          {me?.user && me.user.emailVerified === false && <VerifyEmailBar email={me.user.email} />}
          <PushOptIn />

          <main className="mx-auto w-full max-w-[1240px] flex-1 px-4 py-6 md:px-7">{children}</main>
        </div>
      </div>

      <CommandPalette open={palette} onClose={() => setPalette(false)} />
    </ToastProvider>
  );
}
