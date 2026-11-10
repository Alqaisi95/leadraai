"use client";
import { useEffect, useState } from "react";
import { CalendarClock, Download, FileSpreadsheet, Trash2 } from "lucide-react";
import Shell from "@/components/Shell";
import { Card, StatCard } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Select } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { PageTitle, Skeleton } from "@/components/ui/Empty";
import { getOrg } from "@/lib/client";
import { api } from "@/lib/client";

const EXPORTS = [
  { report: "leads", label: "العملاء", hint: "كل العملاء مع الدرجة والتصنيف والمسؤول" },
  { report: "team", label: "أداء الفريق", hint: "العملاء والصفقات والمواعيد لكل موظف" },
];

const FREQ_LABEL: Record<string, string> = { DAILY: "يوميًا", WEEKLY: "أسبوعيًا", MONTHLY: "شهريًا" };

export default function ReportsPage() {
  const [unanswered, setUnanswered] = useState<any>(null);
  const [ai, setAi] = useState<any>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api("/api/reports/unanswered")
      .then(setUnanswered)
      .catch((e) => setError(e.message));
    api("/api/reports/ai")
      .then(setAi)
      .catch(() => {});
  }, []);

  function download(report: string, format: string) {
    const org = getOrg();
    // The export endpoint streams a file, and a plain navigation is what
    // carries the session cookie with it. Assigning location.href is the only
    // way to start a download — a router navigation renders a page instead.
    // eslint-disable-next-line react-hooks/immutability -- see above
    window.location.href = `/api/reports/export?report=${report}&format=${format}&org=${org ?? ""}`;
  }

  return (
    <Shell>
      <PageTitle>التقارير</PageTitle>
      {error && <p className="mb-4 text-[13px] font-medium text-danger">{error}</p>}

      {ai && (
        <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="محادثات عالجها AI" value={ai.aiHandledRate} suffix="%" />
          <StatCard label="نسبة التسليم البشري" value={ai.handoffRate} suffix="%" />
          <StatCard label="متوسط ثقة AI" value={ai.avgConfidence ?? "—"} />
          <StatCard label="زمن الاستجابة" value={ai.avgLatencyMs ?? "—"} suffix="ms" />
        </div>
      )}

      <section className="mb-5">
        <h2 className="mb-2.5 text-[15px] font-bold">تصدير البيانات</h2>
        <div className="grid gap-2.5 md:grid-cols-2">
          {EXPORTS.map((e) => (
            <Card key={e.report} className="flex items-center justify-between gap-3 px-4 py-3.5">
              <div>
                <div className="text-[13.5px] font-bold">{e.label}</div>
                <div className="mt-0.5 text-[12px] text-dim">{e.hint}</div>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button size="sm" variant="outline" onClick={() => download(e.report, "csv")}>
                  <Download size={12} /> CSV
                </Button>
                <Button size="sm" onClick={() => download(e.report, "xlsx")}>
                  <FileSpreadsheet size={12} /> XLSX
                </Button>
              </div>
            </Card>
          ))}
        </div>
      </section>

      <ScheduleSection />

      <section>
        <h2 className="mb-1 text-[15px] font-bold">
          أسئلة عجز عنها المساعد{" "}
          <span className="font-normal text-dim">(آخر {unanswered?.periodDays ?? 14} يومًا)</span>
        </h2>
        <p className="mb-2.5 text-[12.5px] text-dim">
          كل سطر هنا فجوة في قاعدة المعرفة — أضف مصدرًا يغطيها ويقل التسليم البشري.
        </p>
        {!unanswered && !error && <Skeleton className="h-24" />}
        {unanswered?.items?.length === 0 && (
          <p className="text-[13px] text-dim">لا تسليمات بشرية في هذه الفترة.</p>
        )}
        {unanswered?.items?.length > 0 && (
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-[13px]">
              <thead>
                <tr className="border-b border-line bg-background/60 text-xs text-dim">
                  {["السؤال", "التكرار", "متوسط الثقة", "آخر مرة"].map((h) => (
                    <th key={h} className="px-4 py-2.5 text-start font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {unanswered.items.map((g: any, i: number) => (
                  <tr key={i} className="border-b border-line last:border-0">
                    <td className="px-4 py-2.5">{g.question}</td>
                    <td className="px-4 py-2.5 font-bold">{g.count}</td>
                    <td className={`px-4 py-2.5 ${g.avgConf < 0.5 ? "font-bold text-warn" : ""}`}>
                      {g.avgConf || "—"}
                    </td>
                    <td className="px-4 py-2.5 text-dim">{new Date(g.lastAt).toLocaleDateString("ar-IQ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </section>
    </Shell>
  );
}

/**
 * Scheduled delivery.
 *
 * Sits next to the export buttons on purpose: "download this" and "send me this
 * every week" are the same intent at different cadences, and separating them
 * into different screens would make the second one undiscoverable.
 */
function ScheduleSection() {
  const [data, setData] = useState<any>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const toast = useToast();

  const load = () =>
    api("/api/reports/schedules")
      .then(setData)
      .catch(() => setData({ items: [], reports: [], members: [] }));
  useEffect(() => {
    load();
  }, []);

  async function toggle(s: any) {
    setBusy(s.id);
    try {
      await api(`/api/reports/schedules/${s.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !s.isActive }),
      });
      load();
    } catch (e: any) {
      toast("error", e.message);
    } finally {
      setBusy("");
    }
  }

  async function remove(s: any) {
    setBusy(s.id);
    try {
      await api(`/api/reports/schedules/${s.id}`, { method: "DELETE" });
      toast("success", "حُذف الجدول");
      load();
    } catch (e: any) {
      toast("error", e.message);
    } finally {
      setBusy("");
    }
  }

  if (!data) return <Skeleton className="mb-5 h-24" />;

  return (
    <section className="mb-5">
      <div className="mb-2.5 flex flex-wrap items-center gap-2">
        <h2 className="text-[15px] font-bold">تقارير مجدولة</h2>
        <div className="flex-1" />
        <Button size="sm" onClick={() => setOpen(true)}>
          <CalendarClock size={13} /> جدولة
        </Button>
      </div>

      {data.items.length === 0 ? (
        <Card className="px-4 py-5 text-center">
          <p className="text-[13px] font-semibold">لا تقارير مجدولة</p>
          <p className="mx-auto mt-1 max-w-md text-[12.5px] text-dim">
            بدل أن تتذكّر فتح هذه الصفحة، اجعل التقرير يصلك ويصل فريقك بالبريد في موعد ثابت.
          </p>
        </Card>
      ) : (
        <div className="grid gap-2">
          {data.items.map((s: any) => (
            <Card key={s.id} className="flex flex-wrap items-center gap-2 px-4 py-3">
              <div className="min-w-0">
                <div className="text-[13.5px] font-bold">
                  {data.reports.find((r: any) => r.key === s.report)?.label ?? s.report}
                </div>
                <div className="mt-0.5 text-[12px] text-dim">
                  {FREQ_LABEL[s.frequency] ?? s.frequency} · {s.recipientMemberIds.length} مستلمين ·{" "}
                  {s.lastSentAt ? `أُرسل ${new Date(s.lastSentAt).toLocaleDateString("ar")}` : "لم يُرسل بعد"}
                </div>
                {s.lastError && (
                  <div className="mt-1 text-[11.5px] font-medium text-danger">
                    تعذّر آخر إرسال: {s.lastError}
                  </div>
                )}
              </div>
              <div className="flex-1" />
              <Badge tone={s.isActive ? "primary" : "neutral"}>{s.isActive ? "مفعّل" : "متوقف"}</Badge>
              <Button size="sm" variant="outline" loading={busy === s.id} onClick={() => toggle(s)}>
                {s.isActive ? "إيقاف" : "تفعيل"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => remove(s)} aria-label="حذف الجدول">
                <Trash2 size={13} />
              </Button>
            </Card>
          ))}
        </div>
      )}

      {open && (
        <NewScheduleDialog
          reports={data.reports}
          members={data.members}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            load();
          }}
        />
      )}
    </section>
  );
}

function NewScheduleDialog({
  reports,
  members,
  onClose,
  onSaved,
}: {
  reports: any[];
  members: any[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [report, setReport] = useState(reports[0]?.key ?? "leads");
  const [frequency, setFrequency] = useState("WEEKLY");
  const [recipients, setRecipients] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  async function save() {
    if (recipients.length === 0) return;
    setSaving(true);
    try {
      await api("/api/reports/schedules", {
        method: "POST",
        body: JSON.stringify({ report, frequency, recipientMemberIds: recipients }),
      });
      toast("success", "أُنشئ الجدول");
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
      title="جدولة تقرير"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button onClick={save} loading={saving} disabled={recipients.length === 0}>
            حفظ
          </Button>
        </>
      }
    >
      <div className="grid gap-3.5">
        <Field label="التقرير">
          <Select value={report} onChange={(e) => setReport(e.target.value)}>
            {reports.map((r: any) => (
              <option key={r.key} value={r.key}>
                {r.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="التكرار">
          <Select value={frequency} onChange={(e) => setFrequency(e.target.value)}>
            <option value="DAILY">يوميًا</option>
            <option value="WEEKLY">أسبوعيًا (الأحد)</option>
            <option value="MONTHLY">شهريًا (الأول)</option>
          </Select>
        </Field>
        <div className="grid gap-1.5">
          <span className="text-xs font-semibold text-dim">المستلمون</span>
          <p className="text-[11.5px] text-dim">
            أعضاء هذه المؤسسة فقط — لا يمكن إرسال تقرير إلى عنوان خارجي.
          </p>
          <div className="grid max-h-48 gap-1 overflow-y-auto rounded-field border border-line p-2">
            {members.map((m: any) => (
              <label
                key={m.id}
                className="flex items-center gap-2 rounded px-1.5 py-1 text-[13px] hover:bg-primary-soft/40"
              >
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--primary)]"
                  checked={recipients.includes(m.id)}
                  onChange={() =>
                    setRecipients((r) => (r.includes(m.id) ? r.filter((x) => x !== m.id) : [...r, m.id]))
                  }
                />
                {m.user.fullName}
              </label>
            ))}
          </div>
        </div>
      </div>
    </Dialog>
  );
}
