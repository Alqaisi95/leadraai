"use client";
import { useEffect, useState } from "react";
import { AtSign, Check, Copy, MailX, Plug, RefreshCw, RotateCw, TriangleAlert, X } from "lucide-react";
import Shell from "@/components/Shell";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState, PageTitle, Skeleton } from "@/components/ui/Empty";
import { useToast } from "@/components/ui/Toast";
import { api } from "@/lib/client";

const STATUS: Record<string, { label: string; tone: "primary" | "warn" | "neutral" | "danger" }> = {
  CONNECTED: { label: "متصل", tone: "primary" },
  TOKEN_EXPIRED: { label: "الرمز منتهٍ — أعد الربط", tone: "warn" },
  DISCONNECTED: { label: "غير متصل", tone: "neutral" },
  ERROR: { label: "خطأ", tone: "danger" },
};

function CopyRow({ label, value }: { label: string; value: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="grid gap-1">
      <span className="text-[11.5px] font-semibold text-dim">{label}</span>
      <div className="flex items-center gap-2">
        <code
          className="min-w-0 flex-1 truncate rounded-field border border-line bg-background px-2.5 py-1.5 text-[11.5px]"
          dir="ltr"
        >
          {value}
        </code>
        <Button
          size="sm"
          variant="outline"
          className="shrink-0"
          onClick={() => {
            navigator.clipboard.writeText(value);
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          }}
        >
          {done ? <Check size={12} /> : <Copy size={12} />}
        </Button>
      </div>
    </div>
  );
}

export default function IntegrationsPage() {
  const [items, setItems] = useState<any[] | null>(null);
  const [diag, setDiag] = useState<any>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<any[]>([]);
  const toast = useToast();

  // Separate from load(): a role that cannot read this list must not blank the
  // rest of the page, and its absence is the normal, healthy state.
  const loadFailed = () =>
    api("/api/webhook-events")
      .then((d) => setFailed(d.items))
      .catch(() => setFailed([]));

  const retryFailed = async (id: string) => {
    setBusy(`retry:${id}`);
    try {
      await api("/api/webhook-events", { method: "POST", body: JSON.stringify({ id }) });
      toast("success", "أُعيدت الرسالة إلى المعالجة");
      setFailed((items) => items.filter((i) => i.id !== id));
    } catch (e: any) {
      toast("error", e.message);
      loadFailed();
    } finally {
      setBusy(null);
    }
  };

  const load = () =>
    Promise.all([
      api("/api/integrations").then((d) => setItems(d.items)),
      api("/api/integrations/meta/verify").then(setDiag),
    ]).catch(() => setItems([]));

  useEffect(() => {
    load();
    loadFailed();
    // surface the OAuth round-trip result rather than leaving the user guessing
    const p = new URLSearchParams(window.location.search);
    if (p.get("connected")) {
      toast(
        p.get("degraded") ? "warn" : "success",
        p.get("degraded") ? "تم الربط لكن الاشتراك في الرسائل فشل — راجع التشخيص" : "تم ربط الحساب",
      );
      window.history.replaceState({}, "", "/integrations");
    } else if (p.get("error")) {
      toast("error", `فشل الربط: ${p.get("error")}`);
      window.history.replaceState({}, "", "/integrations");
    }
  }, []);

  async function connect() {
    try {
      const { url } = await api("/api/integrations/meta/connect");
      window.location.href = url;
    } catch (e: any) {
      toast("error", e.message);
    }
  }

  async function resubscribe(id: string) {
    setBusy(id);
    try {
      await api("/api/integrations/meta/verify", {
        method: "POST",
        body: JSON.stringify({ integrationId: id }),
      });
      toast("success", "تم الاشتراك في رسائل الصفحة");
      await load();
    } catch (e: any) {
      toast("error", e.message);
    } finally {
      setBusy(null);
    }
  }

  async function disconnect() {
    if (!confirmId) return;
    setBusy(confirmId);
    try {
      await api("/api/integrations", {
        method: "DELETE",
        body: JSON.stringify({ integrationId: confirmId }),
      });
      toast("success", "تم فصل الحساب وحذف الرمز");
      setConfirmId(null);
      await load();
    } catch (e: any) {
      toast("error", e.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Shell>
      <PageTitle actions={<Button onClick={connect}>+ ربط حساب Instagram</Button>}>مركز التكاملات</PageTitle>

      {/* diagnosis — every one of these can be wrong while the account still says "connected" */}
      {diag && (
        <Card className="mb-4 p-4">
          <h2 className="mb-3 text-[14px] font-bold">تشخيص الإعداد</h2>
          <div className="grid gap-1.5">
            {diag.checks.map((c: any) => (
              <div key={c.key} className="flex items-center gap-2 text-[12.5px]">
                {c.ok ? (
                  <Check size={14} className="shrink-0 text-primary" />
                ) : (
                  <X size={14} className="shrink-0 text-danger" />
                )}
                <span className={c.ok ? "" : "font-semibold text-danger"}>{c.label}</span>
                {c.detail && (
                  <span className="truncate text-dim" dir="ltr">
                    {c.detail}
                  </span>
                )}
              </div>
            ))}
          </div>

          {diag.settings.webhookUrl && (
            <div className="mt-4 grid gap-2.5 border-t border-line pt-3.5">
              <p className="text-[12px] text-dim">الصقها في لوحة Meta — بلا هذه الإعدادات لن تصل أي رسالة:</p>
              <CopyRow label="Webhook Callback URL" value={diag.settings.webhookUrl} />
              <CopyRow label="Valid OAuth Redirect URI" value={diag.settings.redirectUri} />
            </div>
          )}
        </Card>
      )}

      {!items && <Skeleton className="h-32" />}

      {items?.length === 0 && (
        <EmptyState
          icon={<Plug size={20} />}
          title="لا تكاملات بعد"
          hint="اربط حساب Instagram المهني للبدء باستقبال رسائل عملائك. (يتطلب Meta App مُراجَعًا)"
          action={<Button onClick={connect}>ربط الحساب الأول</Button>}
        />
      )}

      <div className="grid gap-2.5">
        {items?.map((i) => {
          const s = STATUS[i.status] ?? { label: i.status, tone: "neutral" as const };
          const acc = diag?.accounts?.find((a: any) => a.id === i.id);
          const notSubscribed = acc && acc.hasPageId && acc.subscribed === false;

          return (
            <Card key={i.id} className="px-4 py-3.5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="grid size-10 place-items-center rounded-lg bg-primary-soft text-primary">
                    <AtSign size={18} />
                  </span>
                  <div>
                    <div className="text-[14px] font-bold">
                      {i.displayName ?? i.provider}{" "}
                      <span className="text-[11.5px] font-normal text-dim">({i.provider})</span>
                    </div>
                    <div className="mt-0.5 text-[12px] text-dim">
                      {i.conversations} محادثة · آخر مزامنة:{" "}
                      {i.lastSyncAt ? new Date(i.lastSyncAt).toLocaleString("ar-IQ") : "—"}
                      {i.errorCount > 0 && ` · أخطاء: ${i.errorCount}`}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2.5">
                  {acc?.subscribed === true && <Badge tone="primary">مشترك في الرسائل</Badge>}
                  <Badge tone={s.tone}>{s.label}</Badge>
                  {i.status === "TOKEN_EXPIRED" && (
                    <Button size="sm" onClick={connect}>
                      إعادة ربط
                    </Button>
                  )}
                  {i.status !== "DISCONNECTED" && (
                    <Button size="sm" variant="outline" onClick={() => setConfirmId(i.id)}>
                      فصل
                    </Button>
                  )}
                </div>
              </div>

              {i.needsReconnect && (
                <div className="mt-3 flex items-start gap-2 rounded-field bg-warn-soft px-3 py-2.5 text-[12.5px]">
                  <TriangleAlert size={14} className="mt-0.5 shrink-0 text-warn" />
                  <div>
                    <b>يحتاج إعادة ربط.</b> هذا الحساب مربوط بصيغة قديمة لا تحفظ رمز الصفحة، فلا يمكنه إرسال
                    ولا استقبال الرسائل.
                    <Button size="sm" className="ms-2" onClick={connect}>
                      أعد الربط الآن
                    </Button>
                  </div>
                </div>
              )}

              {notSubscribed && (
                <div className="mt-3 flex items-start gap-2 rounded-field bg-danger-soft px-3 py-2.5 text-[12.5px]">
                  <TriangleAlert size={14} className="mt-0.5 shrink-0 text-danger" />
                  <div>
                    <b>الصفحة غير مشتركة في رسائل الـ Webhook</b> — لن تصلك أي رسالة جديدة.
                    <Button
                      size="sm"
                      className="ms-2"
                      loading={busy === i.id}
                      onClick={() => resubscribe(i.id)}
                    >
                      <RefreshCw size={12} /> اشترك الآن
                    </Button>
                  </div>
                </div>
              )}

              {i.lastError && !notSubscribed && (
                <p className="mt-3 rounded-field bg-danger-soft px-3 py-2 text-[12.5px] text-danger">
                  {i.lastError}
                </p>
              )}
            </Card>
          );
        })}
      </div>

      {failed.length > 0 && (
        <Card className="mt-4 p-4" data-testid="failed-events">
          <div className="mb-1 flex items-center gap-2">
            <MailX size={16} className="shrink-0 text-danger" />
            <h2 className="text-[14px] font-bold">رسائل تعذّرت معالجتها ({failed.length})</h2>
          </div>
          <p className="mb-3 text-[12.5px] leading-relaxed text-dim">
            وصلت هذه الرسائل من عملائك وفشلت معالجتها خمس مرات، فلم تظهر في صندوق المحادثات. أصلح السبب إن كان
            ظاهرًا (مثل إعادة ربط الحساب) ثم أعد المحاولة.
          </p>
          <div className="grid gap-2">
            {failed.map((f) => (
              <div
                key={f.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-field border border-line px-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold">
                    {f.preview ?? (f.hasAttachments ? "مرفق بلا نص" : "رسالة بلا نص")}
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11.5px] text-dim">
                    <span>{new Date(f.receivedAt).toLocaleString("ar-IQ")}</span>
                    {f.lastError && (
                      <span className="truncate" dir="ltr">
                        {String(f.lastError).slice(0, 90)}
                      </span>
                    )}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  loading={busy === `retry:${f.id}`}
                  onClick={() => retryFailed(f.id)}
                >
                  <RotateCw size={12} /> إعادة المحاولة
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Dialog
        open={confirmId !== null}
        onClose={() => setConfirmId(null)}
        title="فصل الحساب؟"
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmId(null)}>
              إلغاء
            </Button>
            <Button variant="danger" loading={busy === confirmId} onClick={disconnect}>
              فصل وحذف الرمز
            </Button>
          </>
        }
      >
        <p className="text-[13.5px] leading-relaxed text-dim">
          سيتم فصل الحساب وحذف رمز الوصول نهائيًا. المحادثات القديمة تبقى، لكن الرسائل الجديدة لن تصل حتى تعيد
          الربط.
        </p>
      </Dialog>
    </Shell>
  );
}
