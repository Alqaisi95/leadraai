import "./globals.css";
import type { ReactNode } from "react";

export const metadata = { title: "Leadra AI", description: "منصة الذكاء الاصطناعي والCRM العقاري" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
