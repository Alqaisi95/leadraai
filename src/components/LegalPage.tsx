import type { ReactNode } from "react";
import { Logo } from "@/components/Logo";

/** Shared shell for the public legal pages Meta App Review requires. */
export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b border-line">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-5">
          <a href="/">
            <Logo />
          </a>
          <a href="/login" className="text-[13.5px] font-semibold text-dim hover:text-fg">
            دخول
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-12">
        <h1 className="text-[28px] font-bold tracking-tight">{title}</h1>
        <p className="mt-1.5 text-[12.5px] text-dim">آخر تحديث: {updated}</p>
        <div className="legal mt-8">{children}</div>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-5 py-7 text-[12.5px] text-dim">
          <div className="flex gap-4">
            <a href="/privacy" className="hover:text-fg">
              سياسة الخصوصية
            </a>
            <a href="/terms" className="hover:text-fg">
              شروط الاستخدام
            </a>
            <a href="/data-deletion" className="hover:text-fg">
              حذف البيانات
            </a>
          </div>
          <span>© {new Date().getFullYear()} Leadra AI</span>
        </div>
      </footer>
    </div>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-7">
      <h2 className="mb-2.5 text-[17px] font-bold">{title}</h2>
      <div className="grid gap-2.5 text-[14px] leading-[1.9] text-fg/85">{children}</div>
    </section>
  );
}

export function List({ items }: { items: ReactNode[] }) {
  return (
    <ul className="grid gap-1.5 ps-5">
      {items.map((it, i) => (
        <li key={i} className="list-disc marker:text-primary">
          {it}
        </li>
      ))}
    </ul>
  );
}
