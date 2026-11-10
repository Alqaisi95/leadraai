import type { MetadataRoute } from "next";

/** Installable on a sales agent's phone — they work from the field, not a desk. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ليدرا AI — منصة المبيعات العقارية",
    short_name: "ليدرا",
    description: "ردود ذكية على عملائك، تأهيل تلقائي، وCRM عقاري بالعربي",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    dir: "rtl",
    lang: "ar",
    background_color: "#0B1220",
    theme_color: "#0B1220",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "صندوق المحادثات", url: "/inbox" },
      { name: "المهام", url: "/tasks" },
      { name: "المواعيد", url: "/appointments" },
    ],
  };
}
