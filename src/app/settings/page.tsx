"use client";
import { useEffect, useState } from "react";
import {
  Bell,
  Building2,
  Copy,
  CreditCard,
  MessageSquareText,
  Plus,
  Repeat,
  ScrollText,
  ShieldCheck,
  Sliders,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import Shell from "@/components/Shell";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/Input";
import { PageTitle, Skeleton } from "@/components/ui/Empty";
import { useToast } from "@/components/ui/Toast";
import { api } from "@/lib/client";

const ROLES: Record<string, string> = {
  ORG_ADMIN: "مدير المؤسسة",
  SALES_MANAGER: "مدير مبيعات",
  AGENT: "موظف مبيعات",
  MARKETING: "تسويق",
  VIEWER: "مشاهدة فقط",
};

const TABS = [
  { key: "org", label: "المؤسسة", icon: Building2 },
  { key: "team", label: "الفريق", icon: Users },
  { key: "canned", label: "ردود جاهزة", icon: MessageSquareText },
  { key: "notifications", label: "الإشعارات", icon: Bell },
  { key: "billing", label: "الباقة والاشتراك", icon: CreditCard },
  { key: "sequences", label: "المتابعات", icon: Repeat },
  { key: "scoring", label: "قواعد التنقيط", icon: Sliders },
  { key: "security", label: "الأمان", icon: ShieldCheck },
  { key: "audit", label: "سجل التدقيق", icon: ScrollText },
] as const;

const TIMEZONES = [
  "Asia/Baghdad",
  "Asia/Riyadh",
  "Asia/Dubai",
  "Asia/Kuwait",
  "Asia/Qatar",
  "Asia/Amman",
  "Asia/Beirut",
  "Africa/Cairo",
  "Europe/Istanbul",
  "UTC",
];

function OrgTab() {
  const [data, setData] = useState<any>(null);
  const [form, setForm] = useState<any>({});
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const load = () =>
    api("/api/organization")
      .then((d) => {
        setData(d);
        setForm({
          name: d.organization.name,
          country: d.organization.country ?? "",
          timezone: d.organization.timezone,
          slaFirstResponseMin: String(d.organization.slaFirstResponseMin),
        });
      })
      .catch(() => setData(null));
  useEffect(() => {
    load();
  }, []);

  async function save() {
    setBusy(true);
    try {
      await api("/api/organization", {
        method: "PATCH",
        body: JSON.stringify({
          name: form.name,
          country: form.country || null,
          timezone: form.timezone,
          slaFirstResponseMin: Number(form.slaFirstResponseMin),
        }),
      });
      toast("success", "حُفظت إعدادات المؤسسة");
      await load();
    } catch (e: any) {
      toast("error", e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <Skeleton className="h-52" />;

  const sla = Number(form.slaFirstResponseMin);
  const slaValid = Number.isFinite(sla) && sla >= 1 && sla <= 1440;

  return (
    <div className="grid gap-3">
      <Card className="p-4">
        <h2 className="mb-3.5 text-[14px] font-bold">بيانات المؤسسة</h2>
        <div className="grid max-w-lg gap-3">
          <Field label="اسم الشركة">
            <Input value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="الدولة">
              <Input
                value={form.country ?? ""}
                onChange={(e) => setForm({ ...form, country: e.target.value })}
                placeholder="IQ"
              />
            </Field>
            <Field label="المنطقة الزمنية">
              <Select
                value={form.timezone ?? ""}
                onChange={(e) => setForm({ ...form, timezone: e.target.value })}
              >
                {TIMEZONES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="هدف الرد الأول — SLA (بالدقائق)">
            <Input
              inputMode="numeric"
              className="w-32"
              value={form.slaFirstResponseMin ?? ""}
              onChange={(e) => setForm({ ...form, slaFirstResponseMin: e.target.value })}
            />
          </Field>
          <p className="-mt-1.5 text-[12px] text-dim">
            يُحتسب عليه «مخالفات SLA» في تقرير أداء الفريق. كان ثابتًا بـ ١٥ دقيقة لكل المؤسسات قبل الآن.
          </p>
          <div>
            <Button loading={busy} disabled={!form.name || !slaValid} onClick={save}>
              حفظ
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

function CannedTab() {
  const [items, setItems] = useState<any[] | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({});
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const load = () =>
    api("/api/canned-responses")
      .then((d) => setItems(d.items))
      .catch(() => setItems([]));
  useEffect(() => {
    load();
  }, []);

  async function save() {
    setBusy(true);
    try {
      if (form.id) {
        await api("/api/canned-responses", {
          method: "PATCH",
          body: JSON.stringify({ id: form.id, title: form.title, body: form.body }),
        });
      } else {
        await api("/api/canned-responses", {
          method: "POST",
          body: JSON.stringify({ title: form.title, body: form.body }),
        });
      }
      toast("success", "حُفظ الرد");
      setOpen(false);
      setForm({});
      load();
    } catch (e: any) {
      toast("error", e.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    try {
      await api(`/api/canned-responses?id=${id}`, { method: "DELETE" });
      toast("success", "حُذف الرد");
      load();
    } catch (e: any) {
      toast("error", e.message);
    }
  }

  if (!items) return <Skeleton className="h-40" />;

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12.5px] text-dim">
          يدرجها الموظف بنقرة داخل صندوق المحادثات — الأكثر استخدامًا يظهر أولًا.
        </p>
        <Button
          onClick={() => {
            setForm({});
            setOpen(true);
          }}
        >
          <Plus size={14} /> رد جاهز
        </Button>
      </div>

      {items.length === 0 && (
        <p className="rounded-card border border-dashed border-line px-4 py-8 text-center text-[13px] text-dim">
          لا ردود جاهزة بعد. أضف الردود التي يكررها فريقك يوميًا.
        </p>
      )}

      <div className="grid gap-2">
        {items.map((c) => (
          <Card key={c.id} className="flex items-start justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <div className="text-[13.5px] font-bold">{c.title}</div>
              <p className="mt-0.5 whitespace-pre-wrap text-[12.5px] leading-relaxed text-dim">{c.body}</p>
              <div className="mt-1 text-[11px] text-dim">استُخدم {c.useCount} مرة</div>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setForm(c);
                  setOpen(true);
                }}
              >
                تعديل
              </Button>
              <Button size="sm" variant="danger" onClick={() => remove(c.id)}>
                <Trash2 size={12} />
              </Button>
            </div>
          </Card>
        ))}
      </div>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={form.id ? "تعديل الرد" : "رد جاهز جديد"}
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              إلغاء
            </Button>
            <Button
              loading={busy}
              disabled={(form.title ?? "").length < 2 || (form.body ?? "").length < 2}
              onClick={save}
            >
              حفظ
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          <Field label="العنوان (يظهر بالقائمة)">
            <Input
              value={form.title ?? ""}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="ترحيب أولي"
              autoFocus
            />
          </Field>
          <Field label="نص الرد">
            <Textarea
              className="min-h-28"
              value={form.body ?? ""}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
              placeholder="أهلًا بك! سعداء باهتمامك — كيف أقدر أساعدك؟"
            />
          </Field>
        </div>
      </Dialog>
    </>
  );
}

function TeamTab() {
  const [items, setItems] = useState<any[] | null>(null);
  const [seats, setSeats] = useState<{ used: number; limit: number | null }>({ used: 0, limit: null });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({ role: "AGENT" });
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<{ url: string; emailed: boolean } | null>(null);
  const toast = useToast();

  const load = () =>
    api("/api/members")
      .then((d) => {
        setItems(d.items);
        setSeats(d.seats ?? { used: 0, limit: null });
      })
      .catch(() => setItems([]));
  useEffect(() => {
    load();
  }, []);

  async function update(memberId: string, patch: any) {
    try {
      await api("/api/members", { method: "PATCH", body: JSON.stringify({ memberId, ...patch }) });
      toast("success", "تم التحديث");
      load();
    } catch (e: any) {
      toast("error", e.message);
    }
  }

  async function invite() {
    setBusy(true);
    try {
      const res = await api("/api/members/invite", {
        method: "POST",
        body: JSON.stringify({ email: form.email, fullName: form.fullName, role: form.role }),
      });
      setOpen(false);
      setForm({ role: "AGENT" });
      // SMTP is optional — always surface the link so the admin can share it
      setLink({ url: res.url, emailed: res.emailed });
      load();
    } catch (e: any) {
      toast("error", e.message);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(memberId: string) {
    try {
      await api(`/api/members/invite?memberId=${memberId}`, { method: "DELETE" });
      toast("success", "أُلغيت الدعوة");
      load();
    } catch (e: any) {
      toast("error", e.message);
    }
  }

  if (!items) return <Skeleton className="h-40" />;

  const full = seats.limit !== null && seats.used >= seats.limit;

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[12.5px] text-dim">
          {seats.limit !== null ? `${seats.used} من ${seats.limit} مقعدًا مستخدمة` : `${seats.used} عضوًا`}
        </span>
        <Button onClick={() => setOpen(true)} disabled={full} title={full ? "بلغت حد الباقة" : undefined}>
          <UserPlus size={14} /> دعوة عضو
        </Button>
      </div>

      {full && (
        <p className="mb-3 rounded-field bg-warn-soft px-3 py-2 text-[12.5px] text-warn">
          بلغت حد المستخدمين في باقتك — رقّ الباقة لإضافة المزيد.
        </p>
      )}

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-[13px]">
          <thead>
            <tr className="border-b border-line bg-background/60 text-xs text-dim">
              {["العضو", "الدور", "الحالة", "العملاء", "المهام", "MFA"].map((h) => (
                <th key={h} className="px-4 py-2.5 text-start font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((m) => (
              <tr key={m.id} className="border-b border-line last:border-0">
                <td className="px-4 py-2.5">
                  <div className="font-semibold">{m.user.fullName}</div>
                  <div className="text-[11.5px] text-dim" dir="ltr">
                    {m.user.email}
                  </div>
                </td>
                <td className="px-4 py-2.5">
                  <Select
                    className="h-7 w-36 text-[12px]"
                    value={m.role}
                    onChange={(e) => update(m.id, { role: e.target.value })}
                    disabled={m.status === "INVITED"}
                  >
                    {Object.entries(ROLES).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </Select>
                </td>
                <td className="px-4 py-2.5">
                  {m.status === "INVITED" ? (
                    <div className="flex items-center gap-2">
                      <Badge tone={m.inviteExpired ? "danger" : "warn"}>
                        {m.inviteExpired ? "دعوة منتهية" : "دعوة معلّقة"}
                      </Badge>
                      <Button size="sm" variant="outline" onClick={() => revoke(m.id)}>
                        إلغاء
                      </Button>
                    </div>
                  ) : m.status === "ACTIVE" ? (
                    <Button size="sm" variant="outline" onClick={() => update(m.id, { status: "SUSPENDED" })}>
                      تعليق
                    </Button>
                  ) : (
                    <Button size="sm" onClick={() => update(m.id, { status: "ACTIVE" })}>
                      تفعيل
                    </Button>
                  )}
                </td>
                <td className="px-4 py-2.5">{m._count.assignedLeads}</td>
                <td className="px-4 py-2.5">{m._count.tasks}</td>
                <td className="px-4 py-2.5">
                  <Badge tone={m.user.mfaEnabled ? "primary" : "neutral"}>
                    {m.user.mfaEnabled ? "مفعّل" : "غير مفعّل"}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="دعوة عضو جديد"
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              إلغاء
            </Button>
            <Button
              loading={busy}
              disabled={
                !form.email || !/\S+@\S+\.\S+/.test(form.email ?? "") || (form.fullName ?? "").length < 2
              }
              onClick={invite}
            >
              إرسال الدعوة
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          <Field label="الاسم الكامل">
            <Input
              value={form.fullName ?? ""}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })}
              autoFocus
            />
          </Field>
          <Field label="البريد الإلكتروني">
            <Input
              dir="ltr"
              className="text-left"
              value={form.email ?? ""}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </Field>
          <Field label="الدور">
            <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {Object.entries(ROLES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Dialog>

      <Dialog
        open={link !== null}
        onClose={() => setLink(null)}
        title="تم إنشاء الدعوة"
        footer={<Button onClick={() => setLink(null)}>تم</Button>}
      >
        <p className="mb-3 text-[13px] leading-relaxed text-dim">
          {link?.emailed
            ? "أُرسلت الدعوة بالبريد. يمكنك أيضًا مشاركة الرابط مباشرة:"
            : "البريد غير مُعدّ على هذا التثبيت — شارك الرابط مع العضو مباشرة:"}
        </p>
        <div className="flex items-center gap-2">
          <code
            className="min-w-0 flex-1 truncate rounded-field border border-line bg-background px-2.5 py-2 text-[11.5px]"
            dir="ltr"
          >
            {link?.url}
          </code>
          <Button
            size="sm"
            variant="outline"
            className="shrink-0"
            onClick={() => {
              navigator.clipboard.writeText(link!.url);
              toast("success", "نُسخ الرابط");
            }}
          >
            <Copy size={12} />
          </Button>
        </div>
        <p className="mt-2.5 text-[12px] text-dim">الرابط صالح ٧٢ ساعة ويُستخدم مرة واحدة.</p>
      </Dialog>
    </>
  );
}

/**
 * Follow-up sequences.
 *
 * The important thing this screen does is refuse to let anyone activate a
 * sequence without first seeing how many real people it will contact. That
 * count comes from the same query the job runs, so it cannot drift from what
 * actually happens.
 */
function SequencesTab() {
  const [items, setItems] = useState<any[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirming, setConfirming] = useState<any>(null);
  const [busy, setBusy] = useState("");
  const toast = useToast();

  const load = () =>
    api("/api/sequences")
      .then((d) => setItems(d.items))
      .catch(() => setItems([]));
  useEffect(() => {
    load();
  }, []);

  /** Activation is a two-step act: fetch the preview, then confirm against it. */
  async function askToActivate(seq: any) {
    setBusy(seq.id);
    try {
      const d = await api(`/api/sequences/${seq.id}`);
      setConfirming({ sequence: d.sequence, preview: d.preview });
    } catch (e: any) {
      toast("error", e.message);
    } finally {
      setBusy("");
    }
  }

  async function setActive(id: string, isActive: boolean) {
    setBusy(id);
    try {
      await api(`/api/sequences/${id}`, { method: "PATCH", body: JSON.stringify({ isActive }) });
      toast("success", isActive ? "فُعّل التسلسل" : "أُوقف التسلسل");
      setConfirming(null);
      load();
    } catch (e: any) {
      toast("error", e.message);
    } finally {
      setBusy("");
    }
  }

  async function remove(seq: any) {
    setBusy(seq.id);
    try {
      await api(`/api/sequences/${seq.id}`, { method: "DELETE" });
      toast("success", "حُذف التسلسل");
      load();
    } catch (e: any) {
      toast("error", e.message);
    } finally {
      setBusy("");
    }
  }

  if (!items) return <Skeleton className="h-56" />;

  return (
    <div className="grid gap-4">
      <Card className="p-4">
        <div className="mb-3.5 flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-[14px] font-bold">متابعات تلقائية</h2>
            <p className="mt-0.5 text-[12.5px] text-dim">
              تتوقف فورًا حين يردّ العميل، ولا يستلم أي عميل أكثر من رسالة تلقائية واحدة يوميًا.
            </p>
          </div>
          <Button onClick={() => setCreating(true)}>
            <Plus size={15} /> تسلسل
          </Button>
        </div>
        {items.length === 0 ? (
          <div className="grid gap-2 py-6 text-center">
            <p className="text-[13.5px] font-semibold">لا تسلسلات بعد</p>
            <p className="mx-auto max-w-md text-[12.5px] text-dim">
              العميل الذي يصمت لا يتابعه أحد اليوم. أنشئ تسلسلًا يذكّره تلقائيًا، ويتوقف من نفسه بمجرد أن
              يردّ.
            </p>
          </div>
        ) : (
          <div className="grid gap-2.5">
            {items.map((s) => (
              <div key={s.id} className="rounded-field border border-line p-3.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13.5px] font-semibold">{s.name}</span>
                  <Badge tone={s.isActive ? "primary" : "neutral"}>{s.isActive ? "مفعّل" : "متوقف"}</Badge>
                  <span className="text-[12px] text-dim">
                    بعد {s.triggerHours} ساعة صمت · {s.steps.length} خطوات · {s._count.enrollments} قيد
                    المتابعة
                  </span>
                  <div className="flex-1" />
                  <Button
                    variant="outline"
                    className="h-8"
                    loading={busy === s.id}
                    onClick={() => (s.isActive ? setActive(s.id, false) : askToActivate(s))}
                  >
                    {s.isActive ? "إيقاف" : "تفعيل"}
                  </Button>
                  <Button
                    variant="outline"
                    className="h-8"
                    onClick={() => remove(s)}
                    aria-label={`حذف ${s.name}`}
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
                <ol className="mt-2.5 grid gap-1 border-t border-line pt-2.5 text-[12.5px] text-dim">
                  {s.steps.map((st: any) => (
                    <li key={st.id}>
                      <span className="font-medium text-fg">
                        {st.delayHours === 0 ? "فورًا" : `بعد ${st.delayHours} ساعة`}
                      </span>{" "}
                      — {st.action === "SEND_MESSAGE" ? "رسالة" : "مهمة"}: {st.body}
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        )}
      </Card>

      {creating && (
        <NewSequenceDialog
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            load();
          }}
        />
      )}

      <Dialog
        open={!!confirming}
        onClose={() => setConfirming(null)}
        title={`تفعيل ${confirming?.sequence?.name ?? ""}`}
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirming(null)}>
              إلغاء
            </Button>
            <Button
              loading={busy === confirming?.sequence?.id}
              onClick={() => setActive(confirming.sequence.id, true)}
            >
              تفعيل
            </Button>
          </>
        }
      >
        <div className="grid gap-2 text-[13px]">
          <p>
            سيشمل هذا التسلسل الآن{" "}
            <span className="font-bold text-primary">{confirming?.preview?.count ?? 0}</span> عميلًا.
          </p>
          {confirming?.preview?.sample?.length > 0 && (
            <ul className="grid gap-0.5 text-[12.5px] text-dim">
              {confirming.preview.sample.map((l: any) => (
                <li key={l.id}>· {l.fullName ?? "بلا اسم"}</li>
              ))}
              {confirming.preview.count > confirming.preview.sample.length && (
                <li>· و{confirming.preview.count - confirming.preview.sample.length} آخرين</li>
              )}
            </ul>
          )}
          <p className="text-[12px] text-dim">
            تُرسل الخطوة الأولى خلال الساعة القادمة. أي عميل يردّ يخرج من التسلسل فورًا.
          </p>
        </div>
      </Dialog>
    </div>
  );
}

function NewSequenceDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [triggerHours, setTriggerHours] = useState("48");
  const [steps, setSteps] = useState([{ delayHours: "0", action: "SEND_MESSAGE", body: "" }]);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const valid = name.trim().length >= 2 && steps.every((s) => s.body.trim().length >= 2);

  async function save() {
    if (!valid) return;
    setSaving(true);
    try {
      await api("/api/sequences", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          triggerHours: Number(triggerHours) || 48,
          steps: steps.map((s) => ({
            delayHours: Number(s.delayHours) || 0,
            action: s.action,
            body: s.body.trim(),
          })),
        }),
      });
      toast("success", "أُنشئ التسلسل — فعّله بعد مراجعة من سيشملهم");
      onSaved();
    } catch (e: any) {
      toast("error", e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="تسلسل متابعة جديد"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button onClick={save} loading={saving} disabled={!valid}>
            حفظ
          </Button>
        </>
      }
    >
      <div className="grid gap-3.5">
        <Field label="اسم التسلسل">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="متابعة العملاء الباردين"
          />
        </Field>
        <Field label="يبدأ بعد كم ساعة من صمت العميل؟">
          <Input
            type="number"
            min={1}
            dir="ltr"
            className="text-left"
            value={triggerHours}
            onChange={(e) => setTriggerHours(e.target.value)}
          />
        </Field>

        <div className="grid gap-2">
          <span className="text-xs font-semibold text-dim">الخطوات</span>
          {steps.map((s, i) => (
            <div key={i} className="grid gap-2 rounded-field border border-line p-3">
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-semibold text-dim">خطوة {i + 1}</span>
                <div className="flex-1" />
                {steps.length > 1 && (
                  <button
                    className="text-dim hover:text-danger"
                    onClick={() => setSteps(steps.filter((_, x) => x !== i))}
                    aria-label={`حذف الخطوة ${i + 1}`}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <Field label={i === 0 ? "بعد كم ساعة من الانضمام" : "بعد كم ساعة من الخطوة السابقة"}>
                  <Input
                    type="number"
                    min={0}
                    dir="ltr"
                    className="text-left"
                    value={s.delayHours}
                    onChange={(e) =>
                      setSteps(steps.map((x, j) => (j === i ? { ...x, delayHours: e.target.value } : x)))
                    }
                  />
                </Field>
                <Field label="النوع">
                  <Select
                    value={s.action}
                    onChange={(e) =>
                      setSteps(steps.map((x, j) => (j === i ? { ...x, action: e.target.value } : x)))
                    }
                  >
                    <option value="SEND_MESSAGE">رسالة للعميل</option>
                    <option value="CREATE_TASK">مهمة للموظف</option>
                  </Select>
                </Field>
              </div>
              <Field label={s.action === "SEND_MESSAGE" ? "نص الرسالة" : "عنوان المهمة"}>
                <Textarea
                  value={s.body}
                  onChange={(e) =>
                    setSteps(steps.map((x, j) => (j === i ? { ...x, body: e.target.value } : x)))
                  }
                  placeholder={s.action === "SEND_MESSAGE" ? "أهلاً، هل ما زلت مهتمًا؟" : "اتصل بالعميل"}
                />
              </Field>
            </div>
          ))}
          {steps.length < 10 && (
            <Button
              variant="outline"
              className="h-9"
              onClick={() => setSteps([...steps, { delayHours: "48", action: "SEND_MESSAGE", body: "" }])}
            >
              <Plus size={14} /> خطوة
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
}

function ScoringTab() {
  const [items, setItems] = useState<any[] | null>(null);
  const toast = useToast();
  const load = () =>
    api("/api/scoring-rules")
      .then((d) => setItems(d.items))
      .catch(() => setItems([]));
  useEffect(() => {
    load();
  }, []);

  async function save(ruleId: string, patch: any) {
    try {
      await api("/api/scoring-rules", { method: "PATCH", body: JSON.stringify({ ruleId, ...patch }) });
      load();
    } catch (e: any) {
      toast("error", e.message);
    }
  }

  if (!items) return <Skeleton className="h-40" />;

  return (
    <>
      <p className="mb-3 text-[12.5px] text-dim">
        كل حدث يضيف أو يخصم نقاطًا من درجة العميل (0–100). عند 35 نقطة يصبح «دافئ» وعند 70 «جاهز للبيع»
        ويُنبَّه مسؤوله.
      </p>
      <div className="grid gap-2">
        {items.map((r) => (
          <Card key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div>
              <div className="text-[13.5px] font-semibold">{r.label}</div>
              <div className="mt-0.5 text-[11.5px] text-dim" dir="ltr">
                {r.event}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Input
                className="h-8 w-20 text-center"
                inputMode="numeric"
                defaultValue={r.points}
                onBlur={(e) => {
                  const v = Number(e.target.value);
                  if (!Number.isNaN(v) && v !== r.points) save(r.id, { points: v });
                }}
              />
              <Button
                size="sm"
                variant={r.active ? "outline" : "primary"}
                onClick={() => save(r.id, { active: !r.active })}
              >
                {r.active ? "تعطيل" : "تفعيل"}
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}

function SecurityTab() {
  const [me, setMe] = useState<any>(null);
  const [setup, setSetup] = useState<any>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    api("/api/me")
      .then(setMe)
      .catch(() => {});
  }, []);

  async function startSetup() {
    setBusy(true);
    try {
      setSetup(await api("/api/auth/mfa/setup", { method: "POST" }));
    } catch (e: any) {
      toast("error", e.message);
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true);
    try {
      await api("/api/auth/mfa/verify", { method: "POST", body: JSON.stringify({ code }) });
      toast("success", "تم تفعيل المصادقة الثنائية");
      setSetup(null);
      setCode("");
      api("/api/me")
        .then(setMe)
        .catch(() => {});
    } catch (e: any) {
      toast("error", "الرمز غير صحيح");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3">
      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[14px] font-bold">المصادقة الثنائية (MFA)</div>
            <div className="mt-0.5 text-[12.5px] text-dim">
              {me?.user?.mfaEnabled ? "مفعّلة على حسابك." : "طبقة حماية إضافية — موصى بها لمديري المؤسسة."}
            </div>
          </div>
          {!me?.user?.mfaEnabled && !setup && (
            <Button loading={busy} onClick={startSetup}>
              تفعيل
            </Button>
          )}
          {me?.user?.mfaEnabled && <Badge tone="primary">مفعّلة</Badge>}
        </div>

        {setup && (
          <div className="mt-4 border-t border-line pt-4">
            <p className="mb-2 text-[12.5px] text-dim">
              أضف هذا المفتاح في تطبيق المصادقة (Google Authenticator أو ما شابه):
            </p>
            <code
              className="block rounded-field border border-line bg-background px-3 py-2 text-[12.5px]"
              dir="ltr"
            >
              {setup.secret ?? "—"}
            </code>
            <div className="mt-3 flex gap-2">
              <Input
                className="w-40 text-center tracking-[0.3em]"
                inputMode="numeric"
                placeholder="000000"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
              <Button loading={busy} disabled={code.length < 6} onClick={verify}>
                تأكيد
              </Button>
              <Button variant="outline" onClick={() => setSetup(null)}>
                إلغاء
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function AuditTab() {
  const [items, setItems] = useState<any[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api("/api/audit?pageSize=50")
      .then((d) => setItems(d.items))
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <p className="text-[13px] text-dim">سجل التدقيق متاح لمديري المؤسسة فقط.</p>;
  if (!items) return <Skeleton className="h-40" />;
  if (items.length === 0) return <p className="text-[13px] text-dim">لا أحداث مسجلة بعد.</p>;

  return (
    <Card className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-[13px]">
        <thead>
          <tr className="border-b border-line bg-background/60 text-xs text-dim">
            {["الإجراء", "الكيان", "المنفّذ", "الوقت"].map((h) => (
              <th key={h} className="px-4 py-2.5 text-start font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((a) => (
            <tr key={a.id} className="border-b border-line last:border-0">
              <td className="px-4 py-2.5 font-medium" dir="ltr">
                {a.action}
              </td>
              <td className="px-4 py-2.5 text-dim" dir="ltr">
                {a.entityType ?? "—"}
              </td>
              <td className="px-4 py-2.5">{a.actor}</td>
              <td className="px-4 py-2.5 text-dim">{new Date(a.createdAt).toLocaleString("ar-IQ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

/**
 * Notification preferences.
 *
 * Self-scoped by design — the endpoint has no memberId, so this screen can only
 * ever change what *you* receive.
 */
function NotificationsTab() {
  const [data, setData] = useState<any>(null);
  const [prefs, setPrefs] = useState<any>({});
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    api("/api/notifications/preferences")
      .then((d) => {
        setData(d);
        setPrefs(d.prefs);
      })
      .catch((e) => toast("error", e.message));
  }, []);

  if (!data) return <Skeleton className="h-72" />;

  const dirty = JSON.stringify(prefs) !== JSON.stringify(data.prefs);

  function toggle(type: string, channel: "inApp" | "email" | "push") {
    setPrefs((p: any) => ({ ...p, [type]: { ...p[type], [channel]: !p[type][channel] } }));
  }

  async function save() {
    setBusy(true);
    try {
      const res = await api("/api/notifications/preferences", {
        method: "PUT",
        body: JSON.stringify({ prefs }),
      });
      setData({ ...data, prefs: res.prefs });
      setPrefs(res.prefs);
      toast("success", "حُفظت تفضيلات الإشعارات");
    } catch (e: any) {
      toast("error", e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-[12.5px] text-dim">
        اختر ما يصلك داخل التطبيق، وبالبريد، وكإشعار فوري على جهازك. بعض التنبيهات الحرجة — تجاوز مهلة الرد،
        وصحة الربط، ومحاولات الوصول غير المصرّح — تبقى ظاهرة داخل التطبيق دائمًا، ويمكنك إيقاف بريدها فقط.
        الإشعار الفوري يحتاج تفعيله على كل جهاز مرة واحدة.
      </p>

      {data.groups.map((g: any) => (
        <Card key={g.key} className="overflow-hidden">
          <div className="border-b border-line bg-background/60 px-4 py-2.5 text-[13px] font-bold">
            {g.label}
          </div>
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-line text-xs text-dim">
                <th className="px-4 py-2 text-start font-semibold">التنبيه</th>
                <th className="w-28 px-4 py-2 text-center font-semibold">داخل التطبيق</th>
                <th className="w-28 px-4 py-2 text-center font-semibold">البريد</th>
                <th className="w-28 px-4 py-2 text-center font-semibold">فوري</th>
              </tr>
            </thead>
            <tbody>
              {data.types
                .filter((t: any) => t.group === g.key)
                .map((t: any) => (
                  <tr key={t.type} className="border-b border-line last:border-0">
                    <td className="px-4 py-2.5">
                      <div className="font-medium">{t.label}</div>
                      <div className="text-[11.5px] text-dim">{t.hint}</div>
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <input
                        type="checkbox"
                        className="size-4 accent-[var(--primary)] disabled:opacity-40"
                        aria-label={`${t.label} داخل التطبيق`}
                        checked={prefs[t.type]?.inApp ?? true}
                        disabled={!t.canMuteInApp}
                        title={t.canMuteInApp ? undefined : "تنبيه حرج لا يمكن إخفاؤه"}
                        onChange={() => toggle(t.type, "inApp")}
                      />
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <input
                        type="checkbox"
                        className="size-4 accent-[var(--primary)]"
                        aria-label={`${t.label} بالبريد`}
                        checked={prefs[t.type]?.email ?? false}
                        onChange={() => toggle(t.type, "email")}
                      />
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <input
                        type="checkbox"
                        className="size-4 accent-[var(--primary)]"
                        aria-label={`${t.label} إشعار فوري`}
                        checked={prefs[t.type]?.push ?? false}
                        onChange={() => toggle(t.type, "push")}
                      />
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </Card>
      ))}

      <div className="flex items-center gap-3">
        <Button loading={busy} disabled={!dirty} onClick={save}>
          حفظ التفضيلات
        </Button>
        {dirty && <span className="text-[12px] text-warn">تغييرات غير محفوظة</span>}
      </div>
    </div>
  );
}

const STATUS_LABEL: Record<
  string,
  { label: string; tone: "primary" | "info" | "warn" | "danger" | "neutral" }
> = {
  ACTIVE: { label: "نشط", tone: "primary" },
  TRIAL: { label: "تجربة", tone: "info" },
  EXPIRED: { label: "منتهية", tone: "danger" },
  PAST_DUE: { label: "دفعة متأخرة", tone: "warn" },
  CANCELLED: { label: "ملغى", tone: "neutral" },
  NONE: { label: "بلا اشتراك", tone: "neutral" },
};

/** A usage bar that turns before it is too late to act, not after. */
function UsageBar({ def, m }: { def: any; m: any }) {
  const pct = m.limit == null ? 0 : Math.min(100, Math.round((m.used / m.limit) * 100));
  const tone = m.exceeded ? "bg-danger" : pct >= 80 ? "bg-warn" : "bg-primary";

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-[12.5px]">
        <span className="font-medium">
          {def.label}
          {def.perPeriod && <span className="ms-1 text-[11px] text-dim">هذا الشهر</span>}
        </span>
        <span className={m.exceeded ? "font-bold text-danger" : "text-dim"}>
          {m.limit == null ? `${m.used} · بلا حد` : `${m.used} / ${m.limit}`}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-line/60">
        {m.limit != null && (
          <div
            className={`h-full rounded-full ${tone}`}
            style={{ width: `${Math.max(pct, m.used > 0 ? 2 : 0)}%` }}
          />
        )}
      </div>
    </div>
  );
}

function BillingTab() {
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState("");
  const [confirm, setConfirm] = useState<any>(null);
  const toast = useToast();

  const load = () =>
    api("/api/billing")
      .then(setData)
      .catch((e) => toast("error", e.message));
  useEffect(() => {
    load();
  }, []);

  if (!data) return <Skeleton className="h-80" />;

  const sub = data.subscription;
  const status = STATUS_LABEL[sub.effectiveStatus] ?? {
    label: sub.effectiveStatus,
    tone: "neutral" as const,
  };

  async function change(planKey: string) {
    setBusy(planKey);
    try {
      const res = await api("/api/billing/plan", { method: "POST", body: JSON.stringify({ planKey }) });
      toast("success", `تم التحويل إلى باقة ${res.planName}`);
      setConfirm(null);
      await load();
    } catch (e: any) {
      toast("error", e.message);
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="grid gap-3">
      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[14px] font-bold">
            باقتك الحالية: <span className="text-primary">{sub.planName}</span>
          </h2>
          <Badge tone={status.tone}>{status.label}</Badge>
        </div>

        {sub.effectiveStatus === "TRIAL" && sub.trialDaysLeft != null && (
          <p className="mb-3 text-[12.5px] text-dim">
            تبقّى {sub.trialDaysLeft} {sub.trialDaysLeft === 1 ? "يوم" : "أيام"} على انتهاء التجربة (
            {new Date(sub.trialEndsAt).toLocaleDateString("ar-IQ")}). اختر باقة قبلها ليستمر الرد الآلي بلا
            انقطاع.
          </p>
        )}
        {!sub.aiEntitled && (
          <p className="mb-3 rounded-field bg-danger-soft px-3 py-2 text-[12.5px] font-medium text-danger">
            الرد الآلي متوقف لانتهاء الاشتراك. المحادثات ما زالت تصل وتُسنَد للموظفين — لا شيء يضيع.
          </p>
        )}

        <div className="grid max-w-xl gap-3">
          {data.metricDefs.map((def: any) => (
            <UsageBar key={def.key} def={def} m={data.usage[def.key]} />
          ))}
        </div>
        <p className="mt-3 text-[11.5px] text-dim">
          المستخدمون وحسابات Instagram تُحتسب الآن؛ المحادثات وردود المساعد تُصفَّر مع بداية كل شهر ميلادي.
          بلوغ الحد يوقف الرد الآلي فقط — الرسائل تبقى تصل.
        </p>
      </Card>

      <div className="grid gap-3 md:grid-cols-3">
        {data.plans.map((p: any) => {
          const current = p.key === sub.planKey;
          return (
            <Card
              key={p.key}
              className={`flex flex-col p-4 ${current ? "border-primary ring-1 ring-primary/30" : ""}`}
            >
              <div className="mb-1 flex items-center justify-between gap-2">
                <h3 className="text-[15px] font-bold">{p.name}</h3>
                {current && <Badge tone="primary">الحالية</Badge>}
              </div>
              <div className="mb-2 text-[22px] font-bold leading-none">
                {p.priceMonthly === null ? (
                  <span className="text-[15px]">حسب الطلب</span>
                ) : (
                  <>
                    ${p.priceMonthly}
                    <small className="ms-1 text-[12px] font-normal text-dim">/ شهريًا</small>
                  </>
                )}
              </div>
              <p className="mb-2.5 text-[12px] text-dim">{p.tagline}</p>
              <ul className="mb-3 grid flex-1 gap-1 text-[12.5px]">
                {p.features.map((f: string) => (
                  <li key={f} className="flex items-start gap-1.5">
                    <span className="mt-1.5 size-1 shrink-0 rounded-full bg-primary" />
                    {f}
                  </li>
                ))}
              </ul>
              <Button
                variant={current ? "outline" : "primary"}
                disabled={current || busy !== ""}
                loading={busy === p.key}
                onClick={() => setConfirm(p)}
              >
                {current ? "باقتك الحالية" : "التحويل إلى هذه الباقة"}
              </Button>
            </Card>
          );
        })}
      </div>

      <p className="text-[12px] text-dim">
        لا توجد بوابة دفع مربوطة بعد، فتغيير الباقة يسجّل الصلاحيات فورًا ولا يسحب أي مبلغ.
      </p>

      <Dialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={`التحويل إلى باقة ${confirm?.name ?? ""}`}
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirm(null)}>
              إلغاء
            </Button>
            <Button loading={busy !== ""} onClick={() => change(confirm.key)}>
              تأكيد التحويل
            </Button>
          </>
        }
      >
        <div className="grid gap-2 text-[13px]">
          <p>ستصبح حدودك:</p>
          <ul className="grid gap-1 text-[12.5px]">
            {confirm &&
              data.metricDefs.map((def: any) => {
                const to = confirm.limits[def.key];
                const now = data.usage[def.key];
                const over = to != null && now.used > to;
                return (
                  <li key={def.key} className={`flex justify-between ${over ? "font-bold text-danger" : ""}`}>
                    <span>{def.label}</span>
                    <span>
                      {now.limit ?? "بلا حد"} ← {to ?? "بلا حد"}
                      {over && ` (تستهلك ${now.used} الآن)`}
                    </span>
                  </li>
                );
              })}
          </ul>
          <p className="text-[12px] text-dim">
            لن يُسحب أي مبلغ — لا بوابة دفع مربوطة. النزول لباقة أصغر مرفوض ما دام استهلاكك فوق حدودها.
          </p>
        </div>
      </Dialog>
    </div>
  );
}

export default function SettingsPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("org");

  return (
    <Shell>
      <PageTitle>الإعدادات</PageTitle>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors ${
                tab === t.key
                  ? "bg-primary text-primary-fg"
                  : "border border-line bg-card text-dim hover:text-fg"
              }`}
              onClick={() => setTab(t.key)}
            >
              <Icon size={13} />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "org" && <OrgTab />}
      {tab === "team" && <TeamTab />}
      {tab === "canned" && <CannedTab />}
      {tab === "notifications" && <NotificationsTab />}
      {tab === "billing" && <BillingTab />}
      {tab === "sequences" && <SequencesTab />}
      {tab === "scoring" && <ScoringTab />}
      {tab === "security" && <SecurityTab />}
      {tab === "audit" && <AuditTab />}
    </Shell>
  );
}
