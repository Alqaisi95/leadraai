"use client";
import { useEffect, useMemo, useState } from "react";
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { GripVertical, KanbanSquare, Phone, Plus, Rows3, Settings2, Trash2, UserRound } from "lucide-react";
import Shell from "@/components/Shell";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge, TempBadge } from "@/components/ui/Badge";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input, Select } from "@/components/ui/Input";
import { EmptyState, PageTitle, Skeleton } from "@/components/ui/Empty";
import { useToast } from "@/components/ui/Toast";
import { LeadFilters, EMPTY_FILTERS, toQuery, type LeadFilterState } from "@/components/leads/LeadFilters";
import { NewLeadDialog } from "@/components/leads/NewLeadDialog";
import { api } from "@/lib/client";

const PURPOSE: Record<string, string> = { BUY: "شراء", RENT: "إيجار", INVEST: "استثمار", UNKNOWN: "—" };

function LeadCard({ opp }: { opp: any }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: opp.id });
  return (
    <div
      ref={setNodeRef}
      style={
        transform ? { transform: `translate(${transform.x}px, ${transform.y}px)`, zIndex: 40 } : undefined
      }
      className={`relative mb-2 rounded-lg border border-line bg-card p-3 shadow-card ${isDragging ? "opacity-90 shadow-pop" : ""}`}
    >
      <div className="flex items-start justify-between gap-1">
        <a
          href={`/leads/${opp.lead.id}`}
          className="mb-1.5 block text-[13px] font-semibold hover:text-primary"
        >
          {opp.lead.fullName ?? opp.lead.igUsername ?? "عميل"}
        </a>
        <button
          className="-me-1 cursor-grab touch-none text-dim/50 hover:text-dim active:cursor-grabbing"
          aria-label="اسحب لنقل البطاقة"
          {...listeners}
          {...attributes}
        >
          <GripVertical size={14} />
        </button>
      </div>
      <div className="flex items-center justify-between gap-2">
        <TempBadge temperature={opp.lead.temperature} score={opp.lead.score} />
        {opp.lead.phone && (
          <span className="flex items-center gap-1 text-[11px] text-dim" dir="ltr">
            <Phone size={10} />
            {opp.lead.phone}
          </span>
        )}
      </div>
      {opp.lead.nextStep && (
        <div className="mt-1.5 truncate text-[11px] text-warn" title={opp.lead.nextStep}>
          ▸ {opp.lead.nextStep}
        </div>
      )}
      <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-dim">
        <span className="flex items-center gap-1 truncate">
          <UserRound size={10} />
          {opp.lead.owner?.user?.fullName ?? "غير مخصص"}
        </span>
        {opp.value && <span className="shrink-0 font-bold">{Number(opp.value).toLocaleString()} $</span>}
      </div>
    </div>
  );
}

function StageColumn({
  stage,
  filtered,
  onManage,
  children,
}: {
  stage: any;
  filtered: boolean;
  onManage: () => void;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  const value = stage.opportunities.reduce((s: number, o: any) => s + (o.value ? Number(o.value) : 0), 0);
  const shown = stage.opportunities.length;
  const total = stage._count?.opportunities ?? shown;

  return (
    <div
      ref={setNodeRef}
      className={`w-60 shrink-0 rounded-card p-2.5 transition-shadow ${
        stage.isWon ? "bg-primary-soft/70" : stage.isLost ? "bg-danger-soft/40" : "bg-line/30"
      } ${isOver ? "ring-2 ring-ring" : ""}`}
    >
      <div className="group flex items-center justify-between px-1.5 pb-1 pt-1">
        <span className="truncate text-[12.5px] font-bold">{stage.name}</span>
        <span className="flex items-center gap-1">
          <button
            className="text-dim/0 transition-colors group-hover:text-dim hover:!text-primary"
            onClick={onManage}
            aria-label={`إدارة مرحلة ${stage.name}`}
          >
            <Settings2 size={12} />
          </button>
          <span className="rounded-full bg-card px-2 text-[11px] font-bold text-dim">
            {filtered && shown !== total ? `${shown}/${total}` : total}
          </span>
        </span>
      </div>
      <div className="px-1.5 pb-2 text-[10.5px] font-semibold text-dim">
        {value > 0 ? `${value.toLocaleString()} $` : " "}
      </div>
      {children}
      <div className="min-h-6" />
    </div>
  );
}

function LeadTable({ filters, pipeline }: { filters: LeadFilterState; pipeline: any }) {
  const [data, setData] = useState<any>(null);
  const [sort, setSort] = useState("score");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [members, setMembers] = useState<any[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [lostFor, setLostFor] = useState<string | null>(null);
  const [lostReason, setLostReason] = useState("");
  const toast = useToast();

  useEffect(() => {
    api("/api/members")
      .then((d) => setMembers(d.items.filter((m: any) => m.status === "ACTIVE")))
      .catch(() => {});
  }, []);
  useEffect(() => setPage(1), [filters, sort]);
  // a selection that survives a filter change would act on rows no longer shown
  useEffect(() => setSelected(new Set()), [filters, sort, page]);
  useEffect(() => {
    setData(null);
    const p = toQuery(filters);
    p.set("sort", sort);
    p.set("page", String(page));
    p.set("pageSize", "25");
    api(`/api/leads?${p}`)
      .then(setData)
      .catch(() => setData({ items: [], total: 0 }));
  }, [filters, sort, page]);

  function reload() {
    const p = toQuery(filters);
    p.set("sort", sort);
    p.set("page", String(page));
    p.set("pageSize", "25");
    return api(`/api/leads?${p}`).then(setData);
  }

  async function runBulk(payload: any) {
    setBulkBusy(true);
    try {
      const res = await api("/api/leads/bulk", {
        method: "POST",
        body: JSON.stringify({ leadIds: [...selected], ...payload }),
      });
      const notes = [
        `تم تحديث ${res.updated}`,
        res.blocked ? `${res.blocked} مُنعوا بقواعد المرحلة` : null,
        res.skipped ? `${res.skipped} خارج صلاحيتك` : null,
      ].filter(Boolean);
      toast(res.blocked || res.skipped ? "warn" : "success", notes.join(" · "));
      setSelected(new Set());
      setLostFor(null);
      await reload();
    } catch (e: any) {
      toast("error", e.message);
    } finally {
      setBulkBusy(false);
    }
  }

  function moveToStage(stageId: string) {
    const stage = pipeline?.stages?.find((st: any) => st.id === stageId);
    if (stage?.isLost) {
      setLostReason("");
      setLostFor(stageId);
      return;
    }
    runBulk({ action: "stage", stageId });
  }

  if (!data) return <Skeleton className="h-64" />;
  if (data.items.length === 0) {
    return <EmptyState title="لا عملاء مطابقون" hint="جرّب توسيع الفلاتر أو أضف عميلًا يدويًا." />;
  }

  const pages = Math.max(1, Math.ceil(data.total / (data.pageSize ?? 25)));
  const SORTS = [
    { key: "score", label: "الأعلى درجة" },
    { key: "recent", label: "الأحدث نشاطًا" },
    { key: "created", label: "الأحدث إضافة" },
    { key: "name", label: "الاسم" },
  ];

  return (
    <>
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[12.5px] text-dim">{data.total} عميل</span>
        <div className="flex gap-1.5">
          {SORTS.map((s) => (
            <button
              key={s.key}
              className={`rounded-full px-2.5 py-1 text-[11.5px] font-semibold transition-colors ${
                sort === s.key
                  ? "bg-primary text-primary-fg"
                  : "border border-line bg-card text-dim hover:text-fg"
              }`}
              onClick={() => setSort(s.key)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {selected.size > 0 && (
        <Card className="mb-2.5 flex flex-wrap items-center gap-2 px-4 py-2.5">
          <span className="text-[12.5px] font-semibold">{selected.size} محدَّدون</span>
          <Select
            className="h-8 w-40 text-[12px]"
            value=""
            disabled={bulkBusy}
            onChange={(e) =>
              e.target.value &&
              runBulk({
                action: "assign",
                assignedMemberId: e.target.value === "none" ? null : e.target.value,
              })
            }
          >
            <option value="">تخصيص لـ…</option>
            <option value="none">إلغاء التخصيص</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.user.fullName}
              </option>
            ))}
          </Select>
          <Select
            className="h-8 w-40 text-[12px]"
            value=""
            disabled={bulkBusy || !pipeline}
            onChange={(e) => e.target.value && moveToStage(e.target.value)}
          >
            <option value="">نقل إلى مرحلة…</option>
            {pipeline?.stages?.map((st: any) => (
              <option key={st.id} value={st.id}>
                {st.name}
              </option>
            ))}
          </Select>
          <Button size="sm" variant="outline" disabled={bulkBusy} onClick={() => setSelected(new Set())}>
            إلغاء التحديد
          </Button>
        </Card>
      )}

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[880px] text-[13px]">
          <thead>
            <tr className="border-b border-line bg-background/60 text-xs text-dim">
              <th className="w-9 px-3 py-2.5">
                <input
                  type="checkbox"
                  className="size-3.5 accent-[var(--primary)]"
                  aria-label="تحديد كل الصفوف الظاهرة"
                  checked={selected.size > 0 && selected.size === data.items.length}
                  ref={(el) => {
                    if (el) el.indeterminate = selected.size > 0 && selected.size < data.items.length;
                  }}
                  onChange={(e) =>
                    setSelected(e.target.checked ? new Set(data.items.map((l: any) => l.id)) : new Set())
                  }
                />
              </th>
              {["العميل", "التصنيف", "الهاتف", "الغرض", "المنطقة", "الميزانية", "المرحلة", "المسؤول"].map(
                (h) => (
                  <th key={h} className="px-4 py-2.5 text-start font-semibold">
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {data.items.map((l: any) => {
              const opp = l.opportunities?.[0];
              return (
                <tr
                  key={l.id}
                  className={`border-b border-line last:border-0 ${selected.has(l.id) ? "bg-primary-soft/40" : "hover:bg-primary-soft/30"}`}
                >
                  <td className="px-3 py-2.5">
                    <input
                      type="checkbox"
                      className="size-3.5 accent-[var(--primary)]"
                      aria-label={`تحديد ${l.fullName ?? l.igUsername ?? "عميل"}`}
                      checked={selected.has(l.id)}
                      onChange={(e) =>
                        setSelected((prev) => {
                          const next = new Set(prev);
                          e.target.checked ? next.add(l.id) : next.delete(l.id);
                          return next;
                        })
                      }
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    <a href={`/leads/${l.id}`} className="font-semibold hover:text-primary">
                      {l.fullName ?? l.igUsername ?? "عميل"}
                    </a>
                    {l.interestedProject && (
                      <div className="text-[11px] text-dim">{l.interestedProject.name}</div>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <TempBadge temperature={l.temperature} score={l.score} />
                  </td>
                  <td className="px-4 py-2.5 text-dim" dir="ltr">
                    {l.phone ?? "—"}
                  </td>
                  <td className="px-4 py-2.5">{PURPOSE[l.purpose] ?? l.purpose}</td>
                  <td className="px-4 py-2.5 text-dim">
                    {[l.city, l.area].filter(Boolean).join(" — ") || "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    {l.budgetMax || l.budgetMin
                      ? `${l.budgetMin ? Number(l.budgetMin).toLocaleString() : "؟"}–${l.budgetMax ? Number(l.budgetMax).toLocaleString() : "؟"}`
                      : "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    {opp ? (
                      <Badge tone={opp.stage.isWon ? "primary" : opp.stage.isLost ? "danger" : "info"}>
                        {opp.stage.name}
                      </Badge>
                    ) : (
                      <span className="text-dim">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-dim">{l.owner?.user?.fullName ?? "غير مخصص"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <Dialog
        open={lostFor !== null}
        onClose={() => setLostFor(null)}
        title={`سبب خسارة ${selected.size} عميلًا`}
        footer={
          <>
            <Button variant="outline" onClick={() => setLostFor(null)}>
              إلغاء
            </Button>
            <Button
              variant="danger"
              loading={bulkBusy}
              disabled={!lostReason.trim()}
              onClick={() => runBulk({ action: "stage", stageId: lostFor, lostReason: lostReason.trim() })}
            >
              نقل إلى مفقود
            </Button>
          </>
        }
      >
        <Input
          placeholder="سبب واحد يُسجَّل لكل العملاء المحددين"
          value={lostReason}
          onChange={(e) => setLostReason(e.target.value)}
          autoFocus
        />
      </Dialog>

      {pages > 1 && (
        <div className="mt-3 flex items-center justify-center gap-2 text-[12.5px]">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            السابق
          </Button>
          <span className="text-dim">
            صفحة {page} من {pages}
          </span>
          <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            التالي
          </Button>
        </div>
      )}
    </>
  );
}

export default function LeadsPage() {
  const [view, setView] = useState<"board" | "table">("board");
  const [filters, setFilters] = useState<LeadFilterState>(EMPTY_FILTERS);
  const [pipeline, setPipeline] = useState<any>(null);
  const [loadingP, setLoadingP] = useState(true);
  const [lostFor, setLostFor] = useState<{ oppId: string; stageId: string } | null>(null);
  const [lostReason, setLostReason] = useState("");
  const [wonFor, setWonFor] = useState<{ oppId: string; stageId: string } | null>(null);
  const [wonValue, setWonValue] = useState("");
  const [stageDialog, setStageDialog] = useState<any>(null);
  const [stageName, setStageName] = useState("");
  const [newLead, setNewLead] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const filtered = useMemo(
    () => Boolean(filters.q || filters.temperature || filters.ownerId || filters.projectId),
    [filters],
  );

  async function load() {
    const data = await api(`/api/pipelines?${toQuery(filters)}`);
    setPipeline(data.items?.[0] ?? null);
    setLoadingP(false);
  }
  useEffect(() => {
    if (view !== "board") return;
    const t = setTimeout(
      () => {
        load().catch((e) => {
          toast("error", e.message);
          setLoadingP(false);
        });
      },
      filters.q ? 300 : 0,
    );
    return () => clearTimeout(t);
  }, [filters, view]);

  async function move(
    oppId: string,
    stageId: string,
    isLost: boolean,
    reason?: string,
    isWon = false,
    value?: number,
  ) {
    if (isLost && !reason) {
      setLostFor({ oppId, stageId });
      setLostReason("");
      return;
    }
    // Winning a deal is the one moment its value is actually known. Asking now
    // is why the Pipeline figure on the dashboard can be a real number — the
    // column existed and nothing in the product ever wrote to it, so the metric
    // read zero forever no matter how much business closed.
    if (isWon && value === undefined) {
      setWonFor({ oppId, stageId });
      setWonValue("");
      return;
    }
    const prev = pipeline;
    setPipeline((p: any) => {
      if (!p) return p;
      const stages = p.stages.map((s: any) => ({ ...s, opportunities: [...s.opportunities] }));
      let moved: any = null;
      for (const s of stages) {
        const i = s.opportunities.findIndex((o: any) => o.id === oppId);
        if (i >= 0) [moved] = s.opportunities.splice(i, 1);
      }
      if (moved) stages.find((s: any) => s.id === stageId)?.opportunities.unshift(moved);
      return { ...p, stages };
    });
    try {
      await api(`/api/opportunities/${oppId}/move`, {
        method: "POST",
        body: JSON.stringify({ stageId, lostReason: reason, ...(value !== undefined ? { value } : {}) }),
      });
      await load();
    } catch (e: any) {
      setPipeline(prev);
      toast("error", e.message);
    }
  }

  function onDragEnd(ev: DragEndEvent) {
    const oppId = String(ev.active.id);
    const stageId = ev.over ? String(ev.over.id) : null;
    if (!stageId || !pipeline) return;
    const from = pipeline.stages.find((s: any) => s.opportunities.some((o: any) => o.id === oppId));
    const to = pipeline.stages.find((s: any) => s.id === stageId);
    if (!to || from?.id === to.id) return;
    move(oppId, to.id, to.isLost, undefined, to.isWon);
  }

  async function confirmWon(skip = false) {
    if (!wonFor) return;
    setBusy(true);
    // Skipping is allowed: an operator who does not know the number yet should
    // not be blocked from moving the card. Zero is recorded rather than
    // nothing, so the figure stays truthful either way.
    await move(wonFor.oppId, wonFor.stageId, false, undefined, true, skip ? 0 : Number(wonValue) || 0);
    setBusy(false);
    setWonFor(null);
  }

  async function confirmLost() {
    if (!lostFor || !lostReason.trim()) return;
    setBusy(true);
    await move(lostFor.oppId, lostFor.stageId, true, lostReason.trim());
    setBusy(false);
    setLostFor(null);
  }

  async function saveStage() {
    if (!stageDialog) return;
    setBusy(true);
    try {
      if (stageDialog.mode === "create") {
        await api("/api/pipelines/stages", {
          method: "POST",
          body: JSON.stringify({
            pipelineId: pipeline.id,
            name: stageName,
            afterStageId: stageDialog.afterStageId,
          }),
        });
        toast("success", "تمت إضافة المرحلة");
      } else {
        await api("/api/pipelines/stages", {
          method: "PATCH",
          body: JSON.stringify({ stageId: stageDialog.stage.id, name: stageName }),
        });
        toast("success", "تم تعديل المرحلة");
      }
      setStageDialog(null);
      await load();
    } catch (e: any) {
      toast("error", e.message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteStage() {
    if (!stageDialog?.stage) return;
    setBusy(true);
    try {
      await api(`/api/pipelines/stages?stageId=${stageDialog.stage.id}`, { method: "DELETE" });
      toast("success", "تم حذف المرحلة");
      setStageDialog(null);
      await load();
    } catch (e: any) {
      toast("error", e.message);
    } finally {
      setBusy(false);
    }
  }

  const totalShown = pipeline?.stages.reduce((n: number, s: any) => n + s.opportunities.length, 0) ?? 0;

  return (
    <Shell>
      <PageTitle
        actions={
          <>
            <div className="flex overflow-hidden rounded-field border border-line">
              <button
                className={`flex items-center gap-1.5 px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${
                  view === "board" ? "bg-primary text-primary-fg" : "bg-card text-dim hover:text-fg"
                }`}
                onClick={() => setView("board")}
              >
                <KanbanSquare size={13} /> لوحة
              </button>
              <button
                className={`flex items-center gap-1.5 px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${
                  view === "table" ? "bg-primary text-primary-fg" : "bg-card text-dim hover:text-fg"
                }`}
                onClick={() => setView("table")}
              >
                <Rows3 size={13} /> جدول
              </button>
            </div>
            <Button onClick={() => setNewLead(true)}>
              <Plus size={14} /> عميل
            </Button>
          </>
        }
      >
        العملاء والمسار
      </PageTitle>

      <LeadFilters value={filters} onChange={setFilters} />

      {view === "table" ? (
        <LeadTable filters={filters} pipeline={pipeline} />
      ) : (
        <>
          {loadingP && (
            <div className="flex gap-3 overflow-x-auto">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-64 w-60 shrink-0" />
              ))}
            </div>
          )}

          {pipeline && (
            <>
              <p className="-mt-1 mb-3 text-[12px] text-dim">
                اسحب البطاقة من المقبض ⋮ وأفلتها في المرحلة المطلوبة — القواعد تُفرض من الخادم.
                {filtered && ` · ${totalShown} بطاقة مطابقة للفلاتر`}
              </p>
              <DndContext sensors={sensors} onDragEnd={onDragEnd}>
                <div className="flex gap-3 overflow-x-auto pb-3">
                  {pipeline.stages.map((stage: any) => (
                    <StageColumn
                      key={stage.id}
                      stage={stage}
                      filtered={filtered}
                      onManage={() => {
                        setStageDialog({ mode: "edit", stage });
                        setStageName(stage.name);
                      }}
                    >
                      {stage.opportunities.map((opp: any) => (
                        <LeadCard key={opp.id} opp={opp} />
                      ))}
                    </StageColumn>
                  ))}

                  <button
                    className="grid h-fit w-40 shrink-0 place-items-center gap-1 rounded-card border border-dashed border-line px-3 py-6 text-[12.5px] font-semibold text-dim transition-colors hover:border-primary hover:text-primary"
                    onClick={() => {
                      setStageDialog({ mode: "create" });
                      setStageName("");
                    }}
                  >
                    <Plus size={16} />
                    مرحلة جديدة
                  </button>
                </div>
              </DndContext>
            </>
          )}
        </>
      )}

      <NewLeadDialog
        open={newLead}
        onClose={() => setNewLead(false)}
        onCreated={() => (view === "board" ? load() : setFilters({ ...filters }))}
      />

      <Dialog
        open={lostFor !== null}
        onClose={() => setLostFor(null)}
        title="سبب الخسارة"
        footer={
          <>
            <Button variant="outline" onClick={() => setLostFor(null)}>
              إلغاء
            </Button>
            <Button variant="danger" loading={busy} disabled={!lostReason.trim()} onClick={confirmLost}>
              نقل إلى مفقود
            </Button>
          </>
        }
      >
        <Input
          placeholder="مثال: الميزانية غير كافية، اشترى من منافس…"
          value={lostReason}
          onChange={(e) => setLostReason(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && confirmLost()}
          autoFocus
        />
      </Dialog>

      <Dialog
        open={wonFor !== null}
        onClose={() => setWonFor(null)}
        title="قيمة الصفقة"
        footer={
          <>
            <Button variant="outline" loading={busy} onClick={() => confirmWon(true)}>
              لا أعرفها الآن
            </Button>
            <Button loading={busy} onClick={() => confirmWon(false)}>
              تأكيد البيع
            </Button>
          </>
        }
      >
        <div className="grid gap-2">
          <Field label="قيمة الصفقة ($)">
            <Input
              type="number"
              min={0}
              dir="ltr"
              className="text-left"
              placeholder="125000"
              value={wonValue}
              onChange={(e) => setWonValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && confirmWon(false)}
              autoFocus
            />
          </Field>
          <p className="text-[12px] text-dim">
            هذا الرقم هو ما يبني «قيمة الـ Pipeline» و«الصفقات المغلقة» في لوحة القيادة.
          </p>
        </div>
      </Dialog>

      <Dialog
        open={stageDialog !== null}
        onClose={() => setStageDialog(null)}
        title={stageDialog?.mode === "create" ? "مرحلة جديدة" : "تعديل المرحلة"}
        footer={
          <>
            {stageDialog?.mode === "edit" && !stageDialog.stage.isWon && !stageDialog.stage.isLost && (
              <Button variant="danger" loading={busy} onClick={deleteStage} className="me-auto">
                <Trash2 size={13} /> حذف
              </Button>
            )}
            <Button variant="outline" onClick={() => setStageDialog(null)}>
              إلغاء
            </Button>
            <Button loading={busy} disabled={!stageName.trim()} onClick={saveStage}>
              حفظ
            </Button>
          </>
        }
      >
        <Field label="اسم المرحلة">
          <Input
            value={stageName}
            onChange={(e) => setStageName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && saveStage()}
            autoFocus
          />
        </Field>
        {stageDialog?.mode === "edit" && (
          <p className="mt-2.5 text-[12px] text-dim">
            {stageDialog.stage.isWon || stageDialog.stage.isLost
              ? "مرحلة نهائية — لا يمكن حذفها."
              : "الحذف متاح فقط عندما تكون المرحلة فارغة."}
          </p>
        )}
      </Dialog>
    </Shell>
  );
}
