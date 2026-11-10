import "./globals.css";
import type { ReactNode } from "react";
import { IBM_Plex_Sans_Arabic } from "next/font/google";

const plex = IBM_Plex_Sans_Arabic({
  subsets: ["arabic", "latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-plex",
});

export const metadata = {
  title: "ليدرا AI — منصة المحادثات والمبيعات العقارية",
  description:
    "ذكاء اصطناعي يرد على عملائك في Instagram ويحوّل المحادثات إلى صفقات — CRM عقاري متكامل بالعربي",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent" as const, title: "ليدرا" },
  openGraph: {
    type: "website",
    locale: "ar_IQ",
    title: "ليدرا AI — عملاؤك يراسلونك الآن. من يرد عليهم؟",
    description: "ردود ذكية على رسائل Instagram، تأهيل تلقائي للعملاء، وCRM عقاري متكامل بالعربي.",
  },
};

export const viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F7F6F2" },
    { media: "(prefers-color-scheme: dark)", color: "#0B1220" },
  ],
  width: "device-width",
  initialScale: 1,
};

const THEME_INIT = `try{if(localStorage.getItem("leadra_theme")==="dark"||(!localStorage.getItem("leadra_theme")&&matchMedia("(prefers-color-scheme: dark)").matches))document.documentElement.classList.add("dark")}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body className={plex.variable}>{children}</body>
    </html>
  );
}
