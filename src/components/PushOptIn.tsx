"use client";
import { useEffect, useState } from "react";
import { BellRing, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { api } from "@/lib/client";

const DISMISSED_KEY = "leadra_push_dismissed";

function urlBase64ToUint8Array(base64: string) {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/**
 * Ask for notification permission — but not on arrival.
 *
 * A permission prompt on first load is the fastest way to get denied
 * permanently, and a browser denial is not something the app can undo. So this
 * appears as a dismissible bar inside the product, after the person is already
 * using it, and states what they get before asking for anything.
 */
export function PushOptIn() {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    if (!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) return;
    if (localStorage.getItem(DISMISSED_KEY)) return;
    // "denied" is final until the person changes it in browser settings; asking
    // again would do nothing except take up space.
    if (Notification.permission !== "default") return;

    setShow(true);
  }, []);

  async function enable() {
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        toast("warn", "لم يُمنح الإذن — يمكنك تفعيله لاحقًا من إعدادات المتصفح");
        setShow(false);
        return;
      }

      const registration = await navigator.serviceWorker.register("/sw.js");
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!),
      });

      const json = subscription.toJSON();
      await api("/api/push/subscription", {
        method: "POST",
        body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
      });

      toast("success", "فُعّلت الإشعارات على هذا الجهاز");
      setShow(false);
    } catch (e: any) {
      toast("error", e?.message ?? "تعذّر تفعيل الإشعارات");
    } finally {
      setBusy(false);
    }
  }

  function dismiss() {
    localStorage.setItem(DISMISSED_KEY, "1");
    setShow(false);
  }

  if (!show) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-primary-soft/40 px-4 py-2.5 text-[12.5px] md:px-7">
      <BellRing size={15} className="shrink-0 text-primary" aria-hidden />
      <span className="flex-1">
        فعّل الإشعارات لتصلك تنبيهات العملاء الجاهزين للبيع ومهل الرد، حتى والتطبيق مغلق.
      </span>
      <Button className="h-8" loading={busy} onClick={enable}>
        تفعيل
      </Button>
      <button
        onClick={dismiss}
        className="grid size-7 place-items-center rounded-field text-dim hover:text-fg"
        aria-label="إخفاء دعوة تفعيل الإشعارات"
      >
        <X size={14} />
      </button>
    </div>
  );
}
