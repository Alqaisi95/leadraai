"use client";
import { useEffect, useRef, useState } from "react";
import {
  AtSign,
  Bot,
  Building2,
  ExternalLink,
  FileText,
  Home,
  MessagesSquare,
  Phone,
  Search,
  SendHorizonal,
  UserRound,
  MessageSquareText,
  Sparkles,
  Wallet,
  X,
} from "lucide-react";
import Shell from "@/components/Shell";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Input";
import { ConvStatusBadge, CONV_STATUS, TempBadge } from "@/components/ui/Badge";
import { EmptyState, Skeleton } from "@/components/ui/Empty";
import { useToast } from "@/components/ui/Toast";
import { MessageAttachments } from "@/components/conversations/MessageAttachments";
import { describeAttachments, summarizeAttachments } from "@/lib/attachments";
import { api } from "@/lib/client";

const BUBBLE: Record<string, string> = {
  CUSTOMER: "self-start rounded-bl-2xl rounded-tl-2xl rounded-tr-2xl bg-line/45 rounded-br-md",
  AI: "self-end rounded-br-2xl rounded-tr-2xl rounded-tl-2xl bg-primary-soft rounded-bl-md",
  AGENT: "self-end rounded-br-2xl rounded-tr-2xl rounded-tl-2xl bg-primary text-primary-fg rounded-bl-md",
};

const PURPOSE: Record<string, string> = {
  BUY: "شراء",
  RENT: "إيجار",
  INVEST: "استثمار",
  UNKNOWN: "غير محدد",
};

function PanelRow({ icon, label, value }: { icon: React.ReactNode; label: string; value?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 border-b border-line py-2 text-[12.5px] last:border-0">
      <span className="text-dim">{icon}</span>
      <span className="w-16 shrink-0 text-dim">{label}</span>
      <span className="min-w-0 flex-1 truncate font-medium">
        {value ?? <span className="text-dim">—</span>}
      </span>
    </div>
  );
}

function LeadPanel({ leadId, onInsert }: { leadId: string; onInsert?: (text: string) => void }) {
  const [lead, setLead] = useState<any>(null);
  const [matches, setMatches] = useState<any[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setLead(null);
    setMatches(null);
    setFailed(false);
    api(`/api/leads/${leadId}`)
      .then((d) => setLead(d.lead))
      .catch(() => setFailed(true));
    api(`/api/leads/${leadId}/matches`)
      .then((d) => setMatches(d.items))
      .catch(() => setMatches([]));
  }, [leadId]);

  // A failed fetch used to leave the skeleton up forever, which reads as "still
  // loading" and never resolves. The panel is context, not the conversation —
  // its failure must be visible and must not block replying.
  if (failed) {
    return (
      <div className="grid h-full place-items-center rounded-card border border-dashed border-line p-4 text-center">
        <div>
          <p className="text-[12.5px] font-semibold">تعذّر تحميل بيانات العميل</p>
          <p className="mt-1 text-[11.5px] text-dim">يمكنك متابعة الرد — البيانات وحدها لم تصل.</p>
          <a
            href={`/leads/${leadId}`}
            className="mt-2 inline-block text-[12px] font-medium text-primary hover:underline"
          >
            افتح الملف الكامل
          </a>
        </div>
      </div>
    );
  }

  if (!lead) return <Skeleton className="h-full min-h-64" />;

  const openTasks = (lead.tasks ?? []).filter((t: any) => t.status === "OPEN" || t.status === "OVERDUE");

  const budget =
    lead.budgetMin || lead.budgetMax
      ? `${lead.budgetMin ? Number(lead.budgetMin).toLocaleString() : "؟"} – ${lead.budgetMax ? Number(lead.budgetMax).toLocaleString() : "؟"} $`
      : null;

  return (
    <div className="flex h-full flex-col overflow-y-auto rounded-card border border-line bg-card">
      <div className="border-b border-line p-4">
        <div className="flex items-center gap-2.5">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary text-[15px] font-bold text-primary-fg">
            {(lead.fullName ?? lead.igUsername ?? "؟").slice(0, 1)}
          </span>
          <div className="min-w-0">
            <div className="truncate text-[13.5px] font-bold">
              {lead.fullName ?? lead.igUsername ?? "عميل"}
            </div>
            <div className="mt-0.5">
              <TempBadge temperature={lead.temperature} score={lead.score} />
            </div>
          </div>
        </div>
        <a href={`/leads/${lead.id}`} className="mt-3 block">
          <Button variant="outline" size="sm" className="w-full">
            <ExternalLink size={12} /> الملف الكامل
          </Button>
        </a>
      </div>

      <div className="px-4 py-2">
        <PanelRow
          icon={<Phone size={12} />}
          label="الهاتف"
          value={lead.phone && <span dir="ltr">{lead.phone}</span>}
        />
        <PanelRow
          icon={<AtSign size={12} />}
          label="Instagram"
          value={lead.igUsername && <span dir="ltr">@{lead.igUsername}</span>}
        />
        <PanelRow icon={<Wallet size={12} />} label="الميزانية" value={budget} />
        <PanelRow
          icon={<Home size={12} />}
          label="المنطقة"
          value={[lead.city, lead.area].filter(Boolean).join(" — ") || null}
        />
        <PanelRow icon={<Building2 size={12} />} label="المشروع" value={lead.interestedProject?.name} />
        <PanelRow
          icon={<MessagesSquare size={12} />}
          label="الغرض"
          value={PURPOSE[lead.purpose] ?? lead.purpose}
        />
      </div>

      <div className="border-t border-line px-4 py-3">
        <h3 className="mb-2 text-[12px] font-bold text-dim">الوحدات المطابقة</h3>
        {!matches && <Skeleton className="h-12" />}
        {matches?.length === 0 && (
          <p className="text-[11.5px] text-dim">لا مطابقات — أكمل الميزانية/المنطقة.</p>
        )}
        <div className="grid gap-1.5">
          {matches?.slice(0, 4).map((m) => (
            <div key={m.unitId} className="rounded-md border border-line px-2.5 py-1.5 text-[11.5px]">
              <div className="flex justify-between gap-2 font-bold">
                <span className="truncate">
                  {m.projectName} — {m.unitNumber}
                </span>
                <span className="shrink-0">{m.price ? m.price.toLocaleString() + "$" : "—"}</span>
              </div>
              <div className="mt-0.5 truncate text-dim">{m.reasons.join("، ")}</div>
              {onInsert && (
                <button
                  className="mt-1 font-semibold text-primary hover:underline"
                  onClick={() => onInsert(unitOfferText(m))}
                >
                  أدرج في الرد
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {openTasks.length > 0 && (
        <div className="border-t border-line px-4 py-3">
          <h3 className="mb-2 text-[12px] font-bold text-dim">مهام مفتوحة</h3>
          <ul className="grid gap-1 text-[11.5px]">
            {openTasks.slice(0, 4).map((t: any) => (
              <li key={t.id} className="truncate">
                · {t.title}
                {t.dueAt && <span className="text-dim"> — {new Date(t.dueAt).toLocaleDateString("ar")}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * The exact wording an agent would otherwise retype.
 *
 * Retyping a price by hand is how a wrong one reaches a customer — the same
 * risk the AI price guard exists to prevent, just with a human in the loop.
 * This copies it verbatim from the inventory.
 */
function unitOfferText(m: any): string {
  const price = m.price ? `${Number(m.price).toLocaleString()}$` : "السعر عند الطلب";
  return `${m.projectName} — وحدة ${m.unitNumber} — ${price}`;
}

/**
 * One line describing the last message for the conversation list.
 *
 * A voice note has no body, so the row used to read as a blank conversation
 * with nothing in it — indistinguishable from a thread nobody had written in.
 */
function messagePreview(m: { body?: string | null; attachments?: unknown } | undefined): string {
  if (!m) return "…";
  if (m.body?.trim()) return m.body;
  const described = describeAttachments(m.attachments);
  return described.length > 0 ? summarizeAttachments(described) : "…";
}

export default function InboxPage() {
  const [conversations, setConversations] = useState<any[]>([]);
  const [active, setActive] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [reply, setReply] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [assignee, setAssignee] = useState("");
  const [q, setQ] = useState("");
  const [members, setMembers] = useState<any[]>([]);
  const [assigning, setAssigning] = useState(false);
  const [canned, setCanned] = useState<any[]>([]);
  const [cannedOpen, setCannedOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [assisting, setAssisting] = useState<"suggest" | "summary" | null>(null);
  const [summary, setSummary] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const toast = useToast();

  async function loadList() {
    const params = new URLSearchParams();
    if (filter) params.set("status", filter);
    if (assignee) params.set("assignee", assignee);
    if (q.trim()) params.set("q", q.trim());
    const data = await api(`/api/conversations${params.size ? `?${params}` : ""}`);
    setConversations(data.items);
  }
  useEffect(() => {
    const t = setTimeout(() => loadList().catch(() => {}), q ? 350 : 0);
    return () => clearTimeout(t);
  }, [filter, assignee, q]);

  useEffect(() => {
    api("/api/members")
      .then((d) => setMembers(d.items.filter((m: any) => m.status === "ACTIVE")))
      .catch(() => {});
    api("/api/canned-responses")
      .then((d) => setCanned(d.items))
      .catch(() => {});
  }, []);

  async function open(conv: any) {
    setActive(conv);
    setSummary("");
    const data = await api(`/api/conversations/${conv.id}/messages`);
    setMessages(data.messages);
    setTimeout(() => bottomRef.current?.scrollIntoView(), 50);
  }

  // live inbound messages pushed from the SSE stream in Shell
  useEffect(() => {
    function onLive(e: Event) {
      const items = (e as CustomEvent).detail as any[];
      if (active && items.some((m) => m.conversationId === active.id)) {
        api(`/api/conversations/${active.id}/messages`)
          .then((d) => setMessages(d.messages))
          .catch(() => {});
      }
      loadList().catch(() => {});
    }
    window.addEventListener("leadra:messages", onLive);
    return () => window.removeEventListener("leadra:messages", onLive);
  }, [active, filter, assignee, q]);

  async function assign(memberId: string | null) {
    if (!active) return;
    setAssigning(true);
    try {
      const updated = await api(`/api/conversations/${active.id}`, {
        method: "PATCH",
        body: JSON.stringify({ assignedMemberId: memberId }),
      });
      setActive((a: any) => ({ ...a, ...updated }));
      toast("success", memberId ? "تم تخصيص المحادثة" : "أُلغي التخصيص");
      await loadList();
    } catch (e: any) {
      toast("error", e.message);
    } finally {
      setAssigning(false);
    }
  }

  /**
   * Append to whatever the agent has already typed, never replace it.
   *
   * Separated with a space, not a newline: the reply field is a single-line
   * input, which silently drops "\n" — the inserted text ended up glued to the
   * previous word with no separator at all. This affected the existing canned
   * replies too.
   */
  function appendToReply(text: string) {
    setReply((r) => (r.trim() ? `${r.trim()} ${text}` : text));
  }

  function insertText(text: string) {
    appendToReply(text);
    setPanelOpen(false);
  }

  function insertCanned(c: any) {
    appendToReply(c.body);
    setCannedOpen(false);
    api("/api/canned-responses", { method: "PATCH", body: JSON.stringify({ id: c.id, used: true }) }).catch(
      () => {},
    );
  }

  async function assist(mode: "suggest" | "summary") {
    if (!active) return;
    setAssisting(mode);
    try {
      const res = await api(`/api/conversations/${active.id}/assist`, {
        method: "POST",
        body: JSON.stringify({ mode }),
      });
      if (mode === "suggest") {
        setReply(res.text);
        if (res.priceWarning) toast("warn", "المسودة تذكر رقمًا غير مطابق للمخزون — راجعها قبل الإرسال");
      } else {
        setSummary(res.text);
      }
    } catch (e: any) {
      // the API already returns an actionable Arabic message for every AI_* code
      toast("error", e.message);
    } finally {
      setAssisting(null);
    }
  }

  async function send() {
    if (!reply.trim() || !active) return;
    setSending(true);
    try {
      const msg = await api(`/api/conversations/${active.id}/messages`, {
        method: "POST",
        body: JSON.stringify({ text: reply }),
      });
      setMessages((m) => [...m, msg]);
      setReply("");
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    } catch (e: any) {
      toast("error", e.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <Shell>
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        <h1 className="me-3 text-[21px] font-bold tracking-tight">صندوق المحادثات</h1>
        <button
          className={`rounded-full px-3 py-1 text-[12px] font-semibold transition-colors ${
            filter === "" ? "bg-primary text-primary-fg" : "border border-line bg-card text-dim hover:text-fg"
          }`}
          onClick={() => setFilter("")}
        >
          الكل
        </button>
        {Object.entries(CONV_STATUS).map(([k, v]) => (
          <button
            key={k}
            className={`rounded-full px-3 py-1 text-[12px] font-semibold transition-colors ${
              filter === k
                ? "bg-primary text-primary-fg"
                : "border border-line bg-card text-dim hover:text-fg"
            }`}
            onClick={() => setFilter(k)}
          >
            {v.label}
          </button>
        ))}
        <div className="ms-auto flex w-full items-center gap-2 sm:w-auto">
          <Select
            className="h-8.5 w-36 text-[12.5px]"
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
          >
            <option value="">كل المسؤولين</option>
            <option value="me">محادثاتي</option>
            <option value="unassigned">غير مخصصة</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.user.fullName}
              </option>
            ))}
          </Select>
          <div className="relative min-w-0 flex-1 sm:w-56">
            <Search size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-dim" />
            <Input
              className="h-8.5 ps-9 text-[12.5px]"
              aria-label="بحث في المحادثات"
              placeholder="بحث بالاسم، الهاتف، النص…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="grid h-[calc(100dvh-180px)] grid-cols-1 gap-3 md:grid-cols-[300px_1fr] xl:grid-cols-[300px_1fr_280px]">
        {/* list */}
        <div
          className={`overflow-y-auto rounded-card border border-line bg-card ${active ? "hidden md:block" : ""}`}
        >
          {conversations.length === 0 && (
            <p className="p-4 text-[13px] text-dim">
              {q
                ? "لا نتائج مطابقة للبحث."
                : "لا توجد محادثات بعد. اربط حساب Instagram لتبدأ الرسائل بالوصول."}
            </p>
          )}
          {conversations.map((c) => (
            <button
              key={c.id}
              className={`block w-full border-b border-line px-3.5 py-3 text-start transition-colors last:border-0 ${
                active?.id === c.id ? "bg-primary-soft" : "hover:bg-primary-soft/50"
              }`}
              onClick={() => open(c)}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[13.5px] font-semibold">
                  {c.lead?.fullName ?? c.customerUsername ?? "عميل"}
                </span>
                {c.lead && <TempBadge temperature={c.lead.temperature} score={c.lead.score} />}
              </div>
              <div className="mt-1 truncate text-[12px] text-dim">{messagePreview(c.messages?.[0])}</div>
              <div className="mt-1.5 flex items-center justify-between gap-2">
                <ConvStatusBadge status={c.status} />
                <span className="flex items-center gap-1 truncate text-[10.5px] text-dim">
                  <UserRound size={10} />
                  {c.assignedMember?.user?.fullName ?? "غير مخصصة"}
                </span>
              </div>
            </button>
          ))}
        </div>

        {/* thread */}
        <div className="flex min-h-0 flex-col overflow-hidden rounded-card border border-line bg-card">
          {!active ? (
            <div className="grid flex-1 place-items-center p-6">
              <EmptyState icon={<MessagesSquare size={20} />} title="اختر محادثة من القائمة" />
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
                <span className="flex items-center gap-2.5 text-[14px] font-semibold">
                  <button
                    className="text-dim hover:text-fg md:hidden"
                    onClick={() => setActive(null)}
                    aria-label="رجوع"
                  >
                    <X size={16} />
                  </button>
                  {active.lead?.fullName ?? active.customerUsername}
                  <ConvStatusBadge status={active.status} />
                </span>
                <div className="flex items-center gap-2">
                  <Select
                    className="h-7 w-36 text-[11.5px]"
                    value={active.assignedMemberId ?? ""}
                    disabled={assigning}
                    onChange={(e) => assign(e.target.value || null)}
                  >
                    <option value="">غير مخصصة</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.user.fullName}
                      </option>
                    ))}
                  </Select>
                  <Button
                    size="sm"
                    variant="outline"
                    loading={assisting === "summary"}
                    onClick={() => assist("summary")}
                  >
                    <FileText size={12} /> ملخّص
                  </Button>
                  {active.lead && (
                    // Below xl the panel has no column to live in, and it used
                    // to be hidden outright — an agent on a phone saw none of
                    // the customer's budget, area or matching units.
                    <Button
                      size="sm"
                      variant="outline"
                      className="xl:hidden"
                      onClick={() => setPanelOpen(true)}
                    >
                      <ExternalLink size={12} /> بيانات العميل
                    </Button>
                  )}
                </div>
              </div>

              {summary && (
                <div className="border-b border-line bg-primary-soft/40 px-4 py-3">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-[12px] font-bold text-primary">
                      <Sparkles size={12} /> ملخّص المحادثة
                    </span>
                    <button
                      className="text-dim hover:text-fg"
                      onClick={() => setSummary("")}
                      aria-label="إغلاق الملخص"
                    >
                      <X size={14} />
                    </button>
                  </div>
                  <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed">{summary}</p>
                </div>
              )}

              <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto p-4">
                {messages.map((m) => (
                  <div
                    key={m.id}
                    className={`max-w-[72%] px-3.5 py-2.5 text-[13.5px] leading-relaxed ${BUBBLE[m.senderType] ?? BUBBLE.CUSTOMER}`}
                  >
                    {m.body}
                    <MessageAttachments raw={m.attachments} />
                    <div
                      className={`mt-1 flex items-center gap-1 text-[10.5px] ${m.senderType === "AGENT" ? "opacity-75" : "text-dim"}`}
                    >
                      {m.senderType === "AI" && (
                        <>
                          <Bot size={11} /> AI ·
                        </>
                      )}
                      {m.senderType === "AGENT" && "موظف · "}
                      {new Date(m.createdAt).toLocaleTimeString("ar-IQ", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>

              <div className="flex gap-2 border-t border-line p-3">
                {canned.length > 0 && (
                  <div className="relative shrink-0">
                    <Button variant="outline" onClick={() => setCannedOpen((v) => !v)} title="ردود جاهزة">
                      <MessageSquareText size={14} />
                    </Button>
                    {cannedOpen && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setCannedOpen(false)} />
                        <div className="absolute bottom-11 z-20 max-h-72 w-72 overflow-y-auto rounded-card border border-line bg-card p-1 shadow-pop">
                          {canned.map((c) => (
                            <button
                              key={c.id}
                              className="block w-full rounded-md px-2.5 py-2 text-start transition-colors hover:bg-primary-soft"
                              onClick={() => insertCanned(c)}
                            >
                              <div className="text-[12.5px] font-semibold">{c.title}</div>
                              <div className="mt-0.5 line-clamp-2 text-[11.5px] text-dim">{c.body}</div>
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}
                <Button
                  variant="outline"
                  className="shrink-0"
                  loading={assisting === "suggest"}
                  onClick={() => assist("suggest")}
                  title="اقترح مسودة رد"
                >
                  <Sparkles size={14} />
                  <span className="hidden sm:inline">اقترح ردًا</span>
                </Button>
                <Input
                  aria-label="نص الرد"
                  placeholder="اكتب ردك… (الإرسال يوقف AI ويحوّل المحادثة إليك)"
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && send()}
                />
                <Button onClick={send} loading={sending} className="shrink-0">
                  <SendHorizonal size={15} className="-scale-x-100" />
                  إرسال
                </Button>
              </div>
            </>
          )}
        </div>

        {/* lead panel (xl+) */}
        <div className="hidden min-h-0 xl:block">
          {active?.lead ? (
            <LeadPanel leadId={active.lead.id} onInsert={insertText} />
          ) : (
            <div className="grid h-full place-items-center rounded-card border border-dashed border-line text-[12.5px] text-dim">
              بيانات العميل تظهر هنا
            </div>
          )}
        </div>
      </div>

      {/* the same panel as a drawer on narrow screens */}
      {panelOpen && active?.lead && (
        <div className="fixed inset-0 z-50 xl:hidden">
          <div className="absolute inset-0 bg-night/60" onClick={() => setPanelOpen(false)} aria-hidden />
          <div
            className="absolute inset-y-0 start-0 flex w-[min(340px,88vw)] flex-col bg-background p-3 shadow-pop"
            role="dialog"
            aria-label="بيانات العميل"
          >
            <button
              className="mb-2 self-end text-dim hover:text-fg"
              onClick={() => setPanelOpen(false)}
              aria-label="إغلاق بيانات العميل"
            >
              <X size={17} />
            </button>
            <div className="min-h-0 flex-1">
              <LeadPanel leadId={active.lead.id} onInsert={insertText} />
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}
