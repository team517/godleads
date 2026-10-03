import { memo, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, Copy, FileText, Forward, Info, MoreHorizontal, Paperclip, Reply, Trash2 } from "lucide-react";
import { cleanBodyText, decodeSubject, renderableHtml } from "@/lib/unibox-text";
import { sentBodyHtml } from "@/lib/sent-body";
import { detailDate, type Conversation, type LeadStatus } from "@/lib/mobile-inbox";
import { attachmentUrl, type ThreadMessage } from "./mail-actions";
import { Avatar, Bolt, SquareButton, Waves } from "./ui";
import { STATUS_BY_ID } from "@/lib/mobile-inbox";

interface Props {
  conv: Conversation;
  status: LeadStatus;
  thread: ThreadMessage[] | null;
  threadError: string | null;
  accountEmail: string;
  onBack: () => void;
  onMove: () => void;
  onDelete: () => void;
  onMore: () => void;
  onInfo: () => void;
  onStatus: () => void;
  onReply: () => void;
  onForward: () => void;
  onCopied: (what: string) => void;
}

export function ThreadView(p: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Mientras llega el hilo se enseña ya el mensaje de la lista (abre al instante).
  const messages: ThreadMessage[] = useMemo(() => {
    if (p.thread && p.thread.length) return p.thread;
    const m = p.conv.latest;
    return [{ ...m, _type: "received", _date: m.received_at } as ThreadMessage];
  }, [p.thread, p.conv.latest]);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const lastId = messages[messages.length - 1]?.id;

  // Al abrir (y cuando llega el hilo completo) se baja hasta el último mensaje.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || messages.length < 2) return;
    const target = el.querySelector<HTMLElement>(`[data-mid="${lastId}"]`);
    if (target) el.scrollTo({ top: Math.max(0, target.offsetTop - 12) });
  }, [lastId, messages.length]);

  /* Deslizar desde el borde izquierdo para volver (en la app instalada del iPhone no hay gesto). */
  const edge = useRef<{ x: number; y: number; on: boolean }>({ x: 0, y: 0, on: false });
  const [dx, setDx] = useState(0);
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    edge.current = { x: t.clientX, y: t.clientY, on: t.clientX < 28 };
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (!edge.current.on) return;
    const t = e.touches[0];
    const d = t.clientX - edge.current.x;
    if (Math.abs(t.clientY - edge.current.y) > 40 && d < 30) { edge.current.on = false; setDx(0); return; }
    setDx(Math.max(0, d));
  };
  const onTouchEnd = () => {
    if (!edge.current.on) return;
    edge.current.on = false;
    if (dx > 100) p.onBack();
    else setDx(0);
  };

  const s = STATUS_BY_ID[p.status];

  return (
    <div
      className="flex h-full flex-col bg-[#F7F8FC]"
      style={dx ? { transform: `translate3d(${dx}px,0,0)`, transition: "none" } : { transition: "transform 200ms ease" }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {/* Barra superior */}
      <div className="flex items-center gap-2.5 px-4 pb-2 pt-[calc(14px+env(safe-area-inset-top))]">
        <SquareButton label="Volver" onClick={p.onBack}><ChevronLeft className="h-[22px] w-[22px]" strokeWidth={2} /></SquareButton>
        <div className="flex-1" />
        <button type="button" onClick={p.onMove}
          className="m-press m-square flex h-[38px] items-center gap-2.5 rounded-[11px] pl-3.5 pr-3 text-[15px] text-[#1B2140]">
          Move lead
          <ChevronDown className="h-4 w-4 text-[#3A4163]" strokeWidth={2.2} />
        </button>
        <span className="mx-0.5 h-6 w-px bg-[#DCE0EC]" />
        <SquareButton label="Eliminar conversación" onClick={p.onDelete}><Trash2 className="h-[19px] w-[19px]" strokeWidth={1.9} /></SquareButton>
        <SquareButton label="Más opciones" onClick={p.onMore}><MoreHorizontal className="h-[21px] w-[21px]" strokeWidth={2.4} /></SquareButton>
      </div>

      {/* Contacto */}
      <div className="flex items-center gap-2.5 px-4 pb-3 pt-3">
        <Avatar name={p.conv.name} size={48} />
        <div className="min-w-0 flex-1">
          <button type="button" onClick={p.onInfo} className="flex max-w-full items-center gap-1.5 text-left">
            <span className="truncate text-[17px] font-semibold text-[#0E1330]">{p.conv.name}</span>
            <Info className="h-[17px] w-[17px] shrink-0 text-[#7A809B]" strokeWidth={1.9} />
          </button>
          <div className="truncate text-[14.5px] text-[#6E7491]">{p.conv.email}</div>
        </div>
        <button type="button" onClick={p.onStatus}
          className="m-press flex h-[40px] shrink-0 items-center gap-1.5 rounded-[14px] border border-[#DCE3F5] bg-white pl-2.5 pr-2 shadow-[0_1px_2px_rgba(17,24,64,.04)]">
          <Bolt color={s.color} size={16} />
          <span className="whitespace-nowrap text-[14.5px] font-semibold text-[#0E1330]">{s.label}</span>
          <ChevronDown className="h-[15px] w-[15px] text-[#3A4163]" strokeWidth={2.2} />
        </button>
      </div>

      {/* Mensajes */}
      <div ref={scrollRef} className="m-scroll relative min-h-0 flex-1 px-4 pb-4 pt-1">
        <div className="space-y-3">
          {messages.map((m) => (
            <MessageCard
              key={m.id}
              m={m}
              open={m.id === lastId || expanded.has(m.id)}
              onToggle={() => setExpanded((prev) => { const n = new Set(prev); if (n.has(m.id)) n.delete(m.id); else n.add(m.id); return n; })}
              contactEmail={p.conv.email}
              accountEmail={p.accountEmail}
              onCopied={p.onCopied}
            />
          ))}
          {p.thread === null && !p.threadError && (
            <div className="flex justify-center py-2"><span className="m-spin h-5 w-5 rounded-full border-2 border-[#D6DDF7] border-t-[#4D6CF3]" /></div>
          )}
          {p.threadError && <p className="py-2 text-center text-[13.5px] text-[#E5354F]">No se pudo cargar toda la conversación: {p.threadError}</p>}
        </div>
        <Waves className="pointer-events-none mt-4 h-[110px] w-full opacity-80" />
      </div>

      {/* Reply / Forward */}
      <div className="grid grid-cols-2 gap-3 border-t border-[#EEF0F6] bg-[#FBFBFE] px-4 pb-[calc(12px+env(safe-area-inset-bottom))] pt-3">
        <button type="button" onClick={p.onReply}
          className="m-press m-gradient flex h-[52px] items-center justify-center gap-2.5 rounded-[14px] text-[17px] font-semibold text-white">
          <Reply className="h-[21px] w-[21px]" strokeWidth={2} />
          Reply
        </button>
        <button type="button" onClick={p.onForward}
          className="m-press m-btn-outline flex h-[52px] items-center justify-center gap-2.5 rounded-[14px] text-[17px] font-semibold text-[#3D6CF0]">
          <Forward className="h-[21px] w-[21px]" strokeWidth={2} />
          Forward
        </button>
      </div>
    </div>
  );
}

const MessageCard = memo(function MessageCard({ m, open, onToggle, contactEmail, accountEmail, onCopied }: {
  m: ThreadMessage; open: boolean; onToggle: () => void; contactEmail: string; accountEmail: string; onCopied: (what: string) => void;
}) {
  const sent = m._type === "sent";
  const subject = decodeSubject(m.subject ?? null) || "(sin asunto)";
  const from = sent ? accountEmail : (m.from_email || contactEmail);
  const to = sent ? (m.to_email || contactEmail) : (firstAddress(m.to_emails) || accountEmail);
  const cc = sent ? "" : otherAddresses(m.to_emails, m.cc_emails, accountEmail);

  const html = useMemo(() => {
    if (!open) return "";
    if (sent) return sentBodyHtml(m.body);
    return renderableHtml(m.body_html ?? null);
  }, [open, sent, m.body, m.body_html]);
  const plain = useMemo(() => (open && !html ? cleanBodyText(m.body_text ?? m.body ?? null, true) : ""), [open, html, m.body_text, m.body]);

  if (!open) {
    const snippet = cleanBodyText(m.body_text ?? (sent ? stripTags(m.body) : null) ?? null).replace(/\s+/g, " ").slice(0, 120);
    return (
      <button type="button" data-mid={m.id} onClick={onToggle}
        className="m-card m-press block w-full rounded-[16px] px-4 py-3.5 text-left">
        <span className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[14.5px] font-semibold text-[#1B2140]">{sent ? (m._forward ? `Forwarded to ${m.to_email}` : "You") : from}</span>
          <span className="shrink-0 text-[12.5px] text-[#7C819A]">{shortDate(m._date)}</span>
        </span>
        <span className="mt-1 block truncate text-[14px] text-[#6E7491]">{snippet || subject}</span>
      </button>
    );
  }

  return (
    <article data-mid={m.id} className="m-card m-fade-in rounded-[18px] px-[18px] pb-5 pt-5">
      <h1 className="text-[22px] font-bold leading-[1.22] tracking-[-0.01em] text-[#0E1330] [overflow-wrap:anywhere]">{subject}</h1>
      <p className="mt-2 text-[14.5px] text-[#6E7491]">{detailDate(m._date)}</p>
      <div className="mt-3.5 space-y-2">
        <AddressRow label="From:" value={from} onCopied={onCopied} />
        <AddressRow label="To:" value={to} onCopied={onCopied} />
        {cc && <AddressRow label="Cc:" value={cc} onCopied={onCopied} />}
      </div>
      <div className="my-4 h-px bg-[#E6E9F2]" />
      {html
        ? <div className="m-mail px-0.5" dangerouslySetInnerHTML={{ __html: html }} />
        : <div className="m-mail m-mail-plain px-0.5">{plain || <span className="text-[#9AA0BA]">(sin texto)</span>}</div>}
      {!sent && Array.isArray(m.attachments) && m.attachments.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {m.attachments.filter((a) => a && a.path && !a.oversized).map((a) => (
            <button key={a.path} type="button"
              onClick={async () => { const url = await attachmentUrl(a.path); if (url) window.open(url, "_blank", "noopener"); }}
              className="m-press flex max-w-full items-center gap-2 rounded-[11px] border border-[#E3E7F2] bg-[#F7F8FC] px-3 py-2 text-left">
              {/^image\//.test(a.mime || "") ? <Paperclip className="h-4 w-4 shrink-0 text-[#6E58F1]" /> : <FileText className="h-4 w-4 shrink-0 text-[#6E58F1]" />}
              <span className="min-w-0 truncate text-[13.5px] font-medium text-[#1B2140]">{a.name}</span>
            </button>
          ))}
        </div>
      )}
    </article>
  );
});

function AddressRow({ label, value, onCopied }: { label: string; value: string; onCopied: (what: string) => void }) {
  return (
    <div className="flex h-[36px] items-center gap-3 rounded-[10px] bg-[#F3F5FA] pl-3 pr-2">
      <span className="w-[42px] shrink-0 text-[14.5px] font-semibold text-[#1B2140]">{label}</span>
      <span className="min-w-0 flex-1 truncate text-[14.5px] text-[#5F6687]">{value}</span>
      <button type="button" aria-label={`Copiar ${value}`}
        onClick={() => { void navigator.clipboard?.writeText(value).then(() => onCopied(value), () => onCopied("")); }}
        className="m-press flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[#7A809B]">
        <Copy className="h-[15px] w-[15px]" strokeWidth={1.9} />
      </button>
    </div>
  );
}

function firstAddress(list: string | null | undefined): string {
  const m = String(list || "").match(/[^\s<>,;"]+@[^\s<>,;"]+/);
  return m ? m[0].toLowerCase() : "";
}

function otherAddresses(to: string | null | undefined, cc: string | null | undefined, account: string): string {
  const all = `${to || ""},${cc || ""}`.match(/[^\s<>,;"]+@[^\s<>,;"]+/g) || [];
  const own = account.toLowerCase();
  const first = firstAddress(to);
  const rest = Array.from(new Set(all.map((a) => a.toLowerCase()))).filter((a) => a !== own && a !== first);
  return rest.join(", ");
}

function stripTags(s: string | null | undefined): string | null {
  return s ? s.replace(/<[^>]+>/g, " ") : null;
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
