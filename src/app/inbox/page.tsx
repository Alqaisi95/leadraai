"use client";
import { useEffect, useRef, useState } from "react";
import Shell from "@/components/Shell";
import { api } from "@/lib/client";

const STATUS_AR: Record<string, string> = {
  AI_ACTIVE: "AI نشط", NEEDS_HUMAN: "يحتاج موظفاً", ASSIGNED_TO_AGENT: "مخصصة",
  AGENT_ACTIVE: "موظف نشط", FOLLOW_UP_PENDING: "متابعة", CLOSED: "مغلقة", SPAM: "Spam",
};

export default function InboxPage() {
  const [conversations, setConversations] = useState<any[]>([]);
  const [active, setActive] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [matches, setMatches] = useState<any[] | null>(null);
  const [reply, setReply] = useState("");
  const [filter, setFilter] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  async function loadList() {
    const params = filter ? `?status=${filter}` : "";
    const data = await api(`/api/conversations${params}`);
    setConversations(data.items);
    return data.items as any[];
  }
  useEffect(() => {
    loadList()
      .then((items) => {
        // deep link from the lead page: /inbox?c=<conversationId>
        const wanted = new URLSearchParams(window.location.search).get("c");
        if (wanted && !active) open(items.find((c) => c.id === wanted) ?? { id: wanted });
      })
      .catch(() => {});
  }, [filter]); // eslint-disable-line react-hooks/exhaustive-deps

  async function open(conv: any) {
    setActive(conv);
    setMatches(null);
    const data = await api(`/api/conversations/${conv.id}/messages`);
    setMessages(data.messages);
    setTimeout(() => bottomRef.current?.scrollIntoView(), 50);
  }

  async function loadMatches() {
    if (!active?.lead?.id) return;
    const data = await api(`/api/leads/${active.lead.id}/matches`);
    setMatches(data.items);
  }

  async function send() {
    if (!reply.trim() || !active) return;
    setSending(true);
    try {
      const msg = await api(`/api/conversations/${active.id}/messages`, {
        method: "POST", body: JSON.stringify({ text: reply }),
      });
      setMessages((m) => [...m, msg]);
      setReply("");
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    } catch (e: any) {
      alert(e.message);
    } finally { setSending(false); }
  }

  return (
    <Shell>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <h1 className="page-title" style={{ margin: 0 }}>صندوق المحادثات</h1>
        <select className="input" style={{ width: 190 }} value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">كل الحالات</option>
          {Object.entries(STATUS_AR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      <div className="inbox">
        <div className="conv-list">
          {conversations.length === 0 && <p style={{ padding: 16, color: "var(--text-dim)" }}>لا توجد محادثات بعد. اربط حساب Instagram لتبدأ الرسائل بالوصول.</p>}
          {conversations.map((c) => (
            <div key={c.id} className={`conv-item ${active?.id === c.id ? "active" : ""}`} onClick={() => open(c)}>
              <div className="conv-name">
                <span>{c.lead?.fullName ?? c.customerUsername ?? "عميل"}</span>
                {c.lead && <span className={`score-badge score-${c.lead.temperature}`}>{c.lead.score}</span>}
              </div>
              <div className="conv-preview">{c.messages?.[0]?.body ?? "…"}</div>
              <span className={`status-pill status-${c.status}`} style={{ marginTop: 6, display: "inline-block" }}>{STATUS_AR[c.status]}</span>
            </div>
          ))}
        </div>

        <div className="thread">
          {!active ? (
            <div style={{ display: "grid", placeItems: "center", flex: 1, color: "var(--text-dim)" }}>اختر محادثة من القائمة</div>
          ) : (
            <>
              <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--line)", fontWeight: 600, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>
                  {active.lead?.fullName ?? active.customerUsername ?? "محادثة"}
                  <span className={`status-pill status-${active.status}`} style={{ marginRight: 10 }}>{STATUS_AR[active.status]}</span>
                </span>
                {active.lead && (
                  <span className="row" style={{ gap: 6 }}>
                    <a className="btn ghost sm" href={`/leads/${active.lead.id}`}>ملف العميل</a>
                    <button className="btn ghost sm" onClick={loadMatches}>🏠 الوحدات المطابقة</button>
                  </span>
                )}
              </div>
              {matches && (
                <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--line)", background: "#FAF9F6", maxHeight: 180, overflowY: "auto" }}>
                  {matches.length === 0 && <span style={{ fontSize: 12.5, color: "var(--text-dim)" }}>لا وحدات مطابقة — أكمل بيانات العميل (ميزانية/منطقة)</span>}
                  {matches.map((m: any) => (
                    <div key={m.unitId} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 12.5 }}>
                      <span><b>{m.projectName} — {m.unitNumber}</b> · {m.reasons.join("، ")}</span>
                      <span style={{ fontWeight: 700 }}>{m.price ? m.price.toLocaleString() + "$" : "—"}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="thread-messages">
                {messages.map((m) => (
                  <div key={m.id} className={`bubble ${m.senderType}`}>
                    {m.body}
                    <div className="meta">{m.senderType === "AI" ? "🤖 AI" : m.senderType === "AGENT" ? "موظف" : ""} · {new Date(m.createdAt).toLocaleTimeString("ar-IQ", { hour: "2-digit", minute: "2-digit" })}</div>
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>
              <div className="reply-bar">
                <input className="input" placeholder="اكتب ردك… (الإرسال يوقف AI ويحوّل المحادثة إليك)" value={reply}
                  onChange={(e) => setReply(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} />
                <button className="btn" onClick={send} disabled={sending}>إرسال</button>
              </div>
            </>
          )}
        </div>
      </div>
    </Shell>
  );
}
