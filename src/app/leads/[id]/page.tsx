"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  ArrowRight,
  AtSign,
  Building2,
  CalendarDays,
  CalendarPlus,
  CheckSquare,
  Combine,
  Home,
  MessagesSquare,
  Pencil,
  Phone,
  Plus,
  StickyNote,
  TrendingUp,
  UserRound,
  Wallet,
} from "lucide-react";
import Shell from "@/components/Shell";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge, TempBadge } from "@/components/ui/Badge";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/Input";
import { Skeleton } from "@/components/ui/Empty";
import { useToast } from "@/components/ui/Toast";
import { api } from "@/lib/client";

const PURPOSE: Record<string, string> = {
  BUY: "شراء",
  RENT: "إيجار",
  INVEST: "استثمار",
  UNKNOWN: "غير محدد",
};
const TASK_STATUS: Record<string, string> = { OPEN: "مفتوحة", DONE: "منجزة", CANCELLED: "ملغاة" };
const APPT_STATUS: Record<string, string> = {
  SCHEDULED: "مجدول",
  CONFIRMED: "مؤكد",
  COMPLETED: "تمت",
  NO_SHOW: "لم يحضر",
  CANCELLED: "ملغي",
};

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 py-2 text-[13px]">
      <span className="grid size-7 shrink-0 place-items-center rounded-md bg-primary-soft text-primary">
        {icon}
      </span>
      <span className="w-24 shrink-0 text-dim">{label}</span>
      <span className="min-w-0 flex-1 font-medium">{value ?? <span className="text-dim">—</span>}</span>
    </div>
  );
}

export default function LeadProfilePage() {
  const { id } = useParams<{ id: string }>();
  const [lead, setLead] = useState<any>(null);
  const [duplicates, setDuplicates] = useState<any[]>([]);
  const [matches, setMatches] = useState<any[] | null>(null);
  const [members, setMembers] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [error, setError] = useState("");

  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState<any>({});
  const [note, setNote] = useState("");
  const [taskDialog, setTaskDialog] = useState(false);
  const [apptDialog, setApptDialog] = useState(false);
  const [mergeWith, setMergeWith] = useState<any>(null);
  const [quick, setQuick] = useState<any>({});
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  function load() {
    return api(`/api/leads/${id}`)
      .then((d) => {
        setLead(d.lead);
        setDuplicates(d.duplicates ?? []);
      })
      .catch((e) => setError(e.message));
  }

  useEffect(() => {
    load();
    api(`/api/leads/${id}/matches`)
      .then((d) => setMatches(d.items))
      .catch(() => setMatches([]));
    api("/api/members")
      .then((d) => setMembers(d.items.filter((m: any) => m.status === "ACTIVE")))
      .catch(() => {});
    api("/api/projects")
      .then((d) => setProjects(d.items))
      .catch(() => {});
  }, [id]);

  function openEdit() {
    setForm({
      fullName: lead.fullName ?? "",
      phone: lead.phone ?? "",
      email: lead.email ?? "",
      purpose: lead.purpose,
      city: lead.city ?? "",
      area: lead.area ?? "",
      propertyType: lead.propertyType ?? "",
      budgetMin: lead.budgetMin ? String(Number(lead.budgetMin)) : "",
      budgetMax: lead.budgetMax ? String(Number(lead.budgetMax)) : "",
      buyTimeframe: lead.buyTimeframe ?? "",
      nextStep: lead.nextStep ?? "",
      interestedProjectId: lead.interestedProjectId ?? "",
      ownerMemberId: lead.ownerMemberId ?? "",
    });
    setEdit(true);
  }

  const numOrNull = (v: string) => (v === "" ? null : Number(v));

  async function save() {
    setBusy(true);
    try {
      await api(`/api/leads/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          fullName: form.fullName || null,
          phone: form.phone || null,
          email: form.email || null,
          purpose: form.purpose,
          city: form.city || null,
          area: form.area || null,
          propertyType: form.propertyType || null,
          budgetMin: numOrNull(form.budgetMin),
          budgetMax: numOrNull(form.budgetMax),
          buyTimeframe: form.buyTimeframe || null,
          nextStep: form.nextStep || null,
          interestedProjectId: form.interestedProjectId || null,
          ownerMemberId: form.ownerMemberId || null,
        }),
      });
      toast("success", "تم حفظ بيانات العميل");
      setEdit(false);
      await load();
      api(`/api/leads/${id}/matches`)
        .then((d) => setMatches(d.items))
        .catch(() => {});
    } catch (e: any) {
      toast("error", e.message);
    } finally {
      setBusy(false);
    }
  }

  async function addNote() {
    if (!note.trim()) return;
    setBusy(true);
    try {
      await api(`/api/leads/${id}/notes`, { method: "POST", body: JSON.stringify({ body: note.trim() }) });
      setNote("");
      await load();
    } catch (e: any) {
      toast("error", e.message);
    } finally {
      setBusy(false);
    }
  }

  async function addTask() {
    setBusy(true);
    try {
      await api("/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: quick.title,
          leadId: id,
          priority: quick.priority ?? "MEDIUM",
          dueAt: quick.dueAt ? new Date(quick.dueAt).toISOString() : undefined,
        }),
      });
      toast("success", "تمت إضافة المهمة");
      setTaskDialog(false);
      setQuick({});
      await load();
    } catch (e: any) {
      toast("error", e.message);
    } finally {
      setBusy(false);
    }
  }

  async function addAppointment() {
    setBusy(true);
    try {
      await api("/api/appointments", {
        method: "POST",
        body: JSON.stringify({
          leadId: id,
          startsAt: new Date(quick.startsAt).toISOString(),
          location: quick.location || undefined,
          projectId: quick.projectId || undefined,
        }),
      });
      toast("success", "تم جدولة الموعد");
      setApptDialog(false);
      setQuick({});
      await load();
    } catch (e: any) {
      toast("error", e.message);
    } finally {
      setBusy(false);
    }
  }

  async function merge() {
    if (!mergeWith) return;
    setBusy(true);
    try {
      await api(`/api/leads/${id}/merge`, {
        method: "POST",
        body: JSON.stringify({ duplicateLeadId: mergeWith.id }),
      });
      toast("success", "تم دمج السجلين");
      setMergeWith(null);
      await load();
    } catch (e: any) {
      toast("error", e.message);
    } finally {
      setBusy(false);
    }
  }

  const opp = lead?.opportunities?.[0];
  const budget =
    lead?.budgetMin || lead?.budgetMax
      ? `${lead.budgetMin ? Number(lead.budgetMin).toLocaleString() : "؟"} – ${lead.budgetMax ? Number(lead.budgetMax).toLocaleString() : "؟"} $`
      : null;

  return (
    <Shell>
      <a
        href="/leads"
        className="mb-3 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-dim hover:text-primary"
      >
        <ArrowRight size={14} /> رجوع إلى المسار
      </a>

      {error && <p className="text-[13px] font-medium text-danger">{error}</p>}
      {!lead && !error && (
        <div className="grid gap-3 lg:grid-cols-[1fr_1.4fr]">
          <Skeleton className="h-72" />
          <Skeleton className="h-72" />
        </div>
      )}

      {lead && (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3.5">
              <span className="grid size-12 place-items-center rounded-full bg-primary text-lg font-bold text-primary-fg">
                {(lead.fullName ?? lead.igUsername ?? "؟").slice(0, 1)}
              </span>
              <div>
                <h1 className="text-[19px] font-bold leading-tight">
                  {lead.fullName ?? lead.igUsername ?? "عميل"}
                </h1>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <TempBadge temperature={lead.temperature} score={lead.score} />
                  {opp && (
                    <Badge tone={opp.stage.isWon ? "primary" : opp.stage.isLost ? "danger" : "info"}>
                      {opp.stage.name}
                    </Badge>
                  )}
                  <Badge>{PURPOSE[lead.purpose] ?? lead.purpose}</Badge>
                  <span className="flex items-center gap-1 text-[12px] text-dim">
                    <UserRound size={11} />
                    {lead.owner?.user?.fullName ?? "غير مخصص"}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setTaskDialog(true)}>
                <CheckSquare size={14} /> مهمة
              </Button>
              <Button variant="outline" onClick={() => setApptDialog(true)}>
                <CalendarPlus size={14} /> موعد
              </Button>
              {lead.conversation && (
                <a href="/inbox">
                  <Button variant="outline">
                    <MessagesSquare size={14} /> المحادثة
                  </Button>
                </a>
              )}
              <Button onClick={openEdit}>
                <Pencil size={14} /> تعديل
              </Button>
            </div>
          </div>

          {lead.nextStep && (
            <Card className="mb-3 border-s-4 border-s-warn px-4 py-2.5">
              <span className="text-[12px] font-bold text-warn">الخطوة التالية</span>
              <p className="mt-0.5 text-[13.5px]">{lead.nextStep}</p>
            </Card>
          )}

          {duplicates.length > 0 && (
            <Card className="mb-3 border-s-4 border-s-info px-4 py-3">
              <div className="flex items-center gap-2 text-[12.5px] font-bold text-info">
                <Combine size={14} /> سجلات مكرّرة محتملة ({duplicates.length})
              </div>
              <div className="mt-2 grid gap-1.5">
                {duplicates.map((d) => (
                  <div key={d.id} className="flex items-center justify-between gap-3 text-[12.5px]">
                    <span>
                      <a href={`/leads/${d.id}`} className="font-semibold hover:text-primary">
                        {d.fullName ?? d.igUsername ?? "عميل"}
                      </a>
                      <span className="ms-2 text-dim">
                        تطابق في {d.matchedOn === "phone" ? "الهاتف" : d.matchedOn}
                      </span>
                    </span>
                    <Button size="sm" variant="outline" onClick={() => setMergeWith(d)}>
                      دمج هنا
                    </Button>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <div className="grid items-start gap-3 lg:grid-cols-[1fr_1.4fr]">
            <div className="grid gap-3">
              <Card className="px-4 py-2.5">
                <h2 className="border-b border-line pb-2 pt-1 text-[13.5px] font-bold">بيانات العميل</h2>
                <InfoRow
                  icon={<Phone size={13} />}
                  label="الهاتف"
                  value={lead.phone && <span dir="ltr">{lead.phone}</span>}
                />
                <InfoRow
                  icon={<AtSign size={13} />}
                  label="Instagram"
                  value={lead.igUsername && <span dir="ltr">@{lead.igUsername}</span>}
                />
                <InfoRow icon={<Wallet size={13} />} label="الميزانية" value={budget} />
                <InfoRow
                  icon={<Home size={13} />}
                  label="المنطقة"
                  value={[lead.city, lead.area].filter(Boolean).join(" — ") || null}
                />
                <InfoRow
                  icon={<Building2 size={13} />}
                  label="المشروع"
                  value={lead.interestedProject?.name}
                />
                <InfoRow icon={<CalendarDays size={13} />} label="موعد الشراء" value={lead.buyTimeframe} />
              </Card>

              <Card className="p-4">
                <h2 className="mb-2.5 text-[13.5px] font-bold">الوحدات المطابقة</h2>
                {!matches && <Skeleton className="h-16" />}
                {matches?.length === 0 && (
                  <p className="text-[12.5px] text-dim">لا وحدات مطابقة — أكمل الميزانية/المنطقة.</p>
                )}
                <div className="grid gap-2">
                  {matches?.map((m) => (
                    <div key={m.unitId} className="rounded-lg border border-line px-3 py-2 text-[12.5px]">
                      <div className="flex items-center justify-between font-bold">
                        <span>
                          {m.projectName} — {m.unitNumber}
                        </span>
                        <span>{m.price ? m.price.toLocaleString() + "$" : "—"}</span>
                      </div>
                      <div className="mt-0.5 text-dim">{m.reasons.join("، ")}</div>
                    </div>
                  ))}
                </div>
              </Card>
            </div>

            <div className="grid gap-3">
              <Card className="p-4">
                <h2 className="mb-2.5 flex items-center gap-2 text-[13.5px] font-bold">
                  <StickyNote size={15} className="text-primary" /> الملاحظات الداخلية
                </h2>
                <div className="flex gap-2">
                  <Input
                    placeholder="سجّل ما دار في المكالمة…"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addNote()}
                  />
                  <Button
                    className="shrink-0"
                    loading={busy && !!note}
                    disabled={!note.trim()}
                    onClick={addNote}
                  >
                    <Plus size={14} /> إضافة
                  </Button>
                </div>
                {lead.notes?.length === 0 && <p className="mt-3 text-[12.5px] text-dim">لا ملاحظات بعد.</p>}
                <div className="mt-3 grid gap-2">
                  {lead.notes?.map((n: any) => (
                    <div key={n.id} className="rounded-lg border border-line px-3 py-2 text-[12.5px]">
                      <p className="whitespace-pre-wrap leading-relaxed">{n.body}</p>
                      <div className="mt-1 text-[11px] text-dim">
                        {n.author} · {new Date(n.createdAt).toLocaleString("ar-IQ")}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>

              <Card className="p-4">
                <h2 className="mb-3 flex items-center gap-2 text-[13.5px] font-bold">
                  <TrendingUp size={15} className="text-primary" /> سجل النقاط
                </h2>
                {lead.scoreEvents.length === 0 && <p className="text-[12.5px] text-dim">لا أحداث بعد.</p>}
                <div className="grid gap-0.5">
                  {lead.scoreEvents.map((e: any) => (
                    <div
                      key={e.id}
                      className="flex items-center gap-3 border-b border-line py-2 text-[12.5px] last:border-0"
                    >
                      <span
                        className={`w-11 shrink-0 rounded-md px-1.5 py-0.5 text-center font-bold ${
                          e.points >= 0 ? "bg-primary-soft text-primary" : "bg-danger-soft text-danger"
                        }`}
                      >
                        {e.points > 0 ? `+${e.points}` : e.points}
                      </span>
                      <span className="flex-1">{e.reason}</span>
                      <span className="shrink-0 text-[11px] text-dim">
                        {new Date(e.createdAt).toLocaleDateString("ar-IQ")}
                      </span>
                      <span className="w-10 shrink-0 text-end text-[11px] font-bold text-dim">
                        {e.scoreAfter}
                      </span>
                    </div>
                  ))}
                </div>
              </Card>

              <div className="grid gap-3 md:grid-cols-2">
                <Card className="p-4">
                  <h2 className="mb-2.5 flex items-center gap-2 text-[13.5px] font-bold">
                    <CheckSquare size={15} className="text-primary" /> المهام
                  </h2>
                  {lead.tasks.length === 0 && <p className="text-[12.5px] text-dim">لا مهام مرتبطة.</p>}
                  <div className="grid gap-2">
                    {lead.tasks.map((t: any) => (
                      <div key={t.id} className="rounded-lg border border-line px-3 py-2 text-[12.5px]">
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={`font-semibold ${t.status === "DONE" ? "text-dim line-through" : ""}`}
                          >
                            {t.title}
                          </span>
                          <Badge tone={t.status === "DONE" ? "primary" : "neutral"}>
                            {TASK_STATUS[t.status] ?? t.status}
                          </Badge>
                        </div>
                        <div className="mt-1 text-[11px] text-dim">
                          {t.assignee ? t.assignee.user.fullName : "غير مخصصة"}
                          {t.dueAt && ` · تستحق ${new Date(t.dueAt).toLocaleDateString("ar-IQ")}`}
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>

                <Card className="p-4">
                  <h2 className="mb-2.5 flex items-center gap-2 text-[13.5px] font-bold">
                    <CalendarDays size={15} className="text-primary" /> المواعيد
                  </h2>
                  {lead.appointments.length === 0 && <p className="text-[12.5px] text-dim">لا مواعيد.</p>}
                  <div className="grid gap-2">
                    {lead.appointments.map((a: any) => (
                      <div key={a.id} className="rounded-lg border border-line px-3 py-2 text-[12.5px]">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold">
                            {new Date(a.startsAt).toLocaleString("ar-IQ", {
                              dateStyle: "medium",
                              timeStyle: "short",
                            })}
                          </span>
                          <Badge
                            tone={
                              a.status === "COMPLETED"
                                ? "primary"
                                : a.status === "CANCELLED" || a.status === "NO_SHOW"
                                  ? "danger"
                                  : "info"
                            }
                          >
                            {APPT_STATUS[a.status] ?? a.status}
                          </Badge>
                        </div>
                        <div className="mt-1 text-[11px] text-dim">
                          {a.member.user.fullName}
                          {a.location && ` · ${a.location}`}
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>
            </div>
          </div>
        </>
      )}

      {/* edit */}
      <Dialog
        open={edit}
        onClose={() => setEdit(false)}
        title="تعديل بيانات العميل"
        footer={
          <>
            <Button variant="outline" onClick={() => setEdit(false)}>
              إلغاء
            </Button>
            <Button loading={busy} onClick={save}>
              حفظ
            </Button>
          </>
        }
      >
        <div className="grid max-h-[60vh] gap-3 overflow-y-auto pe-1">
          <Field label="الاسم">
            <Input
              value={form.fullName ?? ""}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="الهاتف">
              <Input
                dir="ltr"
                className="text-left"
                value={form.phone ?? ""}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </Field>
            <Field label="البريد">
              <Input
                dir="ltr"
                className="text-left"
                value={form.email ?? ""}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </Field>
            <Field label="الغرض">
              <Select value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })}>
                {Object.entries(PURPOSE).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="نوع العقار">
              <Input
                value={form.propertyType ?? ""}
                onChange={(e) => setForm({ ...form, propertyType: e.target.value })}
                placeholder="شقة"
              />
            </Field>
            <Field label="المدينة">
              <Input value={form.city ?? ""} onChange={(e) => setForm({ ...form, city: e.target.value })} />
            </Field>
            <Field label="المنطقة">
              <Input value={form.area ?? ""} onChange={(e) => setForm({ ...form, area: e.target.value })} />
            </Field>
            <Field label="الميزانية من ($)">
              <Input
                inputMode="numeric"
                value={form.budgetMin ?? ""}
                onChange={(e) => setForm({ ...form, budgetMin: e.target.value })}
              />
            </Field>
            <Field label="إلى ($)">
              <Input
                inputMode="numeric"
                value={form.budgetMax ?? ""}
                onChange={(e) => setForm({ ...form, budgetMax: e.target.value })}
              />
            </Field>
          </div>
          <Field label="موعد الشراء">
            <Input
              value={form.buyTimeframe ?? ""}
              onChange={(e) => setForm({ ...form, buyTimeframe: e.target.value })}
              placeholder="خلال 3 أشهر"
            />
          </Field>
          <Field label="المشروع المهتم به">
            <Select
              value={form.interestedProjectId ?? ""}
              onChange={(e) => setForm({ ...form, interestedProjectId: e.target.value })}
            >
              <option value="">غير محدد</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="المسؤول">
            <Select
              value={form.ownerMemberId ?? ""}
              onChange={(e) => setForm({ ...form, ownerMemberId: e.target.value })}
            >
              <option value="">غير مخصص</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.user.fullName}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="الخطوة التالية">
            <Textarea
              className="min-h-16"
              value={form.nextStep ?? ""}
              onChange={(e) => setForm({ ...form, nextStep: e.target.value })}
              placeholder="اتصال يوم الخميس لتأكيد الزيارة"
            />
          </Field>
        </div>
      </Dialog>

      {/* quick task */}
      <Dialog
        open={taskDialog}
        onClose={() => setTaskDialog(false)}
        title="مهمة مرتبطة بالعميل"
        footer={
          <>
            <Button variant="outline" onClick={() => setTaskDialog(false)}>
              إلغاء
            </Button>
            <Button loading={busy} disabled={!quick.title || quick.title.length < 2} onClick={addTask}>
              إضافة
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          <Field label="عنوان المهمة">
            <Input
              value={quick.title ?? ""}
              onChange={(e) => setQuick({ ...quick, title: e.target.value })}
              placeholder="اتصال متابعة"
              autoFocus
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="الأولوية">
              <Select
                value={quick.priority ?? "MEDIUM"}
                onChange={(e) => setQuick({ ...quick, priority: e.target.value })}
              >
                <option value="URGENT">عاجلة</option>
                <option value="HIGH">مرتفعة</option>
                <option value="MEDIUM">متوسطة</option>
                <option value="LOW">منخفضة</option>
              </Select>
            </Field>
            <Field label="الاستحقاق">
              <Input
                type="date"
                value={quick.dueAt ?? ""}
                onChange={(e) => setQuick({ ...quick, dueAt: e.target.value })}
              />
            </Field>
          </div>
        </div>
      </Dialog>

      {/* quick appointment */}
      <Dialog
        open={apptDialog}
        onClose={() => setApptDialog(false)}
        title="جدولة موعد زيارة"
        footer={
          <>
            <Button variant="outline" onClick={() => setApptDialog(false)}>
              إلغاء
            </Button>
            <Button loading={busy} disabled={!quick.startsAt} onClick={addAppointment}>
              جدولة
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          <Field label="التاريخ والوقت">
            <Input
              type="datetime-local"
              value={quick.startsAt ?? ""}
              onChange={(e) => setQuick({ ...quick, startsAt: e.target.value })}
              autoFocus
            />
          </Field>
          <Field label="المشروع">
            <Select
              value={quick.projectId ?? ""}
              onChange={(e) => setQuick({ ...quick, projectId: e.target.value })}
            >
              <option value="">غير محدد</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="المكان">
            <Input
              value={quick.location ?? ""}
              onChange={(e) => setQuick({ ...quick, location: e.target.value })}
              placeholder="موقع المشروع"
            />
          </Field>
        </div>
      </Dialog>

      {/* merge confirm */}
      <Dialog
        open={mergeWith !== null}
        onClose={() => setMergeWith(null)}
        title="دمج السجلين"
        footer={
          <>
            <Button variant="outline" onClick={() => setMergeWith(null)}>
              إلغاء
            </Button>
            <Button loading={busy} onClick={merge}>
              تأكيد الدمج
            </Button>
          </>
        }
      >
        <p className="text-[13.5px] leading-relaxed text-dim">
          سيُدمج <b className="text-fg">{mergeWith?.fullName ?? mergeWith?.igUsername ?? "السجل المكرر"}</b>{" "}
          في هذا العميل: تنتقل الملاحظات والمهام والمواعيد إليه، وتُملأ الحقول الفارغة فقط دون استبدال بياناته
          الحالية. السجل المكرر لا يُحذف — يبقى مؤرشفًا ومرتبطًا لأغراض التدقيق.
        </p>
      </Dialog>
    </Shell>
  );
}
