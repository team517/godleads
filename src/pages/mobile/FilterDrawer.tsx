import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Check, ChevronDown, ChevronUp, Folder, Mail, MoreHorizontal, Search, Send, Star, X } from "lucide-react";
import { SparkMark } from "@/components/SparkMark";
import { LEAD_STATUSES, type Conversation, type LeadStatus, type MobileFilters } from "@/lib/mobile-inbox";
import type { Campaign, Folder as FolderRow } from "./useMobileInbox";
import { Bolt, Waves } from "./ui";

interface Props {
  open: boolean;
  onClose: () => void;
  filters: MobileFilters;
  onChange: (patch: Partial<MobileFilters>) => void;
  counts: Record<LeadStatus, { total: number; unread: number }>;
  conversations: Conversation[];
  accountEmails: Record<string, string>;
  campaigns: Campaign[];
  folders: FolderRow[];
}

/* El menú de filtros que sale por la izquierda, como en el diseño. */
export function FilterDrawer(p: Props) {
  const [mounted, setMounted] = useState(p.open);
  const [shown, setShown] = useState(false);
  const [section, setSection] = useState<{ status: boolean; inboxes: boolean; campaigns: boolean; more: boolean }>({ status: true, inboxes: false, campaigns: false, more: false });
  const [inboxQuery, setInboxQuery] = useState("");

  useEffect(() => {
    if (p.open) {
      setMounted(true);
      const r = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
      return () => cancelAnimationFrame(r);
    }
    setShown(false);
    const t = window.setTimeout(() => setMounted(false), 280);
    return () => window.clearTimeout(t);
  }, [p.open]);

  // Buzones y campañas que tienen respuestas (con cuántas), de más a menos.
  const inboxes = useMemo(() => {
    const n = new Map<string, number>();
    for (const c of p.conversations) n.set(c.accountId, (n.get(c.accountId) || 0) + 1);
    return [...n.entries()].map(([id, count]) => ({ id, count, email: p.accountEmails[id] || "…" }))
      .sort((a, b) => b.count - a.count || a.email.localeCompare(b.email));
  }, [p.conversations, p.accountEmails]);
  const campaignList = useMemo(() => {
    const n = new Map<string, number>();
    for (const c of p.conversations) if (c.campaignId) n.set(c.campaignId, (n.get(c.campaignId) || 0) + 1);
    const names = new Map(p.campaigns.map((c) => [c.id, c.name]));
    return [...n.entries()].map(([id, count]) => ({ id, count, name: names.get(id) || "Campaña" }))
      .sort((a, b) => b.count - a.count);
  }, [p.conversations, p.campaigns]);

  // Arrastrar hacia la izquierda para cerrar.
  const [dragX, setDragX] = useState(0);
  const [startX, setStartX] = useState<number | null>(null);

  if (!mounted) return null;
  const f = p.filters;
  const inboxLabel = f.accountId ? (p.accountEmails[f.accountId] || "Buzón") : "All Inboxes";
  const campaignLabel = f.campaignId ? (campaignList.find((c) => c.id === f.campaignId)?.name || p.campaigns.find((c) => c.id === f.campaignId)?.name || "Campaña") : "All Campaigns";
  const moreCount = (f.unreadOnly ? 1 : 0) + (f.importantOnly ? 1 : 0) + (f.folderId ? 1 : 0);
  const q = inboxQuery.trim().toLowerCase();
  const inboxesShown = (q ? inboxes.filter((i) => i.email.toLowerCase().includes(q)) : inboxes).slice(0, 80);

  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label="Filtros">
      <div className={`m-backdrop absolute inset-0 transition-opacity duration-300 ${shown ? "opacity-100" : "opacity-0"}`} onClick={p.onClose} />
      <aside
        className="absolute inset-y-0 left-0 flex w-[min(82vw,330px)] flex-col overflow-hidden bg-white shadow-[12px_0_40px_rgba(20,25,60,.18)]"
        style={{
          transform: shown ? `translateX(${Math.min(0, dragX)}px)` : "translateX(-102%)",
          transition: startX === null ? "transform 300ms cubic-bezier(.2,.8,.2,1)" : "none",
          background: "linear-gradient(180deg,#FFFFFF 0%,#F9FAFE 100%)",
        }}
        onTouchStart={(e) => setStartX(e.touches[0].clientX)}
        onTouchMove={(e) => { if (startX !== null) setDragX(e.touches[0].clientX - startX); }}
        onTouchEnd={() => { const d = dragX; setStartX(null); setDragX(0); if (d < -70) p.onClose(); }}
      >
        <Waves className="absolute inset-x-0 bottom-0 h-[160px] w-full" />

        {/* Cabecera */}
        <div className="relative flex items-center gap-3 px-5 pb-4 pt-[calc(18px+env(safe-area-inset-top))]">
          <SparkMark size={44} className="rounded-[12px]" />
          <span className="flex-1 text-[23px] font-bold tracking-[-0.015em] text-[#0E1330]">OnePulso</span>
          <button type="button" aria-label="Cerrar filtros" onClick={p.onClose}
            className="m-press m-field flex h-10 w-10 items-center justify-center rounded-[11px] text-[#5B6283]">
            <X className="h-[19px] w-[19px]" />
          </button>
        </div>
        <div className="relative mx-4 h-px bg-[#E9ECF4]" />

        <div className="m-scroll relative min-h-0 flex-1 px-4 pb-[calc(24px+env(safe-area-inset-bottom))] pt-3">
          {/* Status */}
          <button type="button" onClick={() => setSection((s) => ({ ...s, status: !s.status }))}
            className="flex w-full items-center justify-between px-1.5 py-2.5">
            <span className="text-[16px] font-semibold text-[#5B6283]">Status</span>
            {section.status ? <ChevronUp className="h-[18px] w-[18px] text-[#5B6283]" /> : <ChevronDown className="h-[18px] w-[18px] text-[#5B6283]" />}
          </button>
          {section.status && (
            <div className="space-y-[7px] pb-2 pt-1">
              {LEAD_STATUSES.map((s) => {
                const active = f.status === s.id;
                const c = p.counts[s.id];
                return (
                  <button key={s.id} type="button" onClick={() => p.onChange({ status: active ? null : s.id })}
                    className={`m-press flex h-[46px] w-full items-center gap-3.5 rounded-[12px] border pl-2 pr-2.5 text-left ${active ? "border-[#C9D4FA] bg-[#E9EEFE]" : "border-[#EEF0F6] bg-white"}`}>
                    <span className="flex h-[34px] w-[34px] items-center justify-center rounded-[9px]" style={{ background: s.tile }}>
                      <Bolt color={s.color} filled size={18} />
                    </span>
                    <span className="flex-1 truncate text-[15.5px] font-medium text-[#0E1330]">{s.label}</span>
                    <span className={`flex h-[25px] min-w-[25px] items-center justify-center rounded-full px-1.5 text-[12.5px] font-semibold ${
                      active ? "bg-[#D6DFFC] text-[#3159E3]" : c.unread > 0 ? "bg-[#ECE7FD] text-[#5B3DE2]" : "bg-[#F0F2F7] text-[#5F6680]"}`}>
                      {c.total}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* All Inboxes */}
          <Collapsible
            icon={<Mail className="h-[19px] w-[19px]" strokeWidth={1.9} />}
            label={inboxLabel}
            active={!!f.accountId}
            open={section.inboxes}
            onToggle={() => setSection((s) => ({ ...s, inboxes: !s.inboxes }))}
          >
            {inboxes.length > 8 && (
              <label className="mx-1 mb-2 flex h-10 items-center gap-2 rounded-[10px] border border-[#E6E9F3] bg-white px-3">
                <Search className="h-4 w-4 text-[#7A809B]" />
                <input value={inboxQuery} onChange={(e) => setInboxQuery(e.target.value)} placeholder="Buscar buzón…"
                  autoCapitalize="none" autoCorrect="off" className="min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-[#9AA0BA]" />
              </label>
            )}
            <Option label="All Inboxes" selected={!f.accountId} onClick={() => p.onChange({ accountId: null })} />
            {inboxesShown.map((i) => (
              <Option key={i.id} label={i.email} count={i.count} selected={f.accountId === i.id} onClick={() => p.onChange({ accountId: i.id })} />
            ))}
          </Collapsible>

          {/* All Campaigns */}
          <Collapsible
            icon={<Send className="h-[19px] w-[19px]" strokeWidth={1.9} />}
            label={campaignLabel}
            active={!!f.campaignId}
            open={section.campaigns}
            onToggle={() => setSection((s) => ({ ...s, campaigns: !s.campaigns }))}
          >
            <Option label="All Campaigns" selected={!f.campaignId} onClick={() => p.onChange({ campaignId: null })} />
            {campaignList.map((c) => (
              <Option key={c.id} label={c.name} count={c.count} selected={f.campaignId === c.id} onClick={() => p.onChange({ campaignId: c.id })} />
            ))}
          </Collapsible>

          {/* More */}
          <Collapsible
            icon={<MoreHorizontal className="h-[20px] w-[20px]" strokeWidth={2.4} />}
            label="More"
            badge={moreCount || undefined}
            active={moreCount > 0}
            open={section.more}
            onToggle={() => setSection((s) => ({ ...s, more: !s.more }))}
          >
            <Option label="Unread" icon={<span className="h-2.5 w-2.5 rounded-full bg-[#2F6BEA]" />} selected={f.unreadOnly} onClick={() => p.onChange({ unreadOnly: !f.unreadOnly })} />
            <Option label="Important" icon={<Star className="h-4 w-4 text-[#F5A524]" />} selected={f.importantOnly} onClick={() => p.onChange({ importantOnly: !f.importantOnly })} />
            {p.folders.map((fo) => (
              <Option key={fo.id} label={fo.name} icon={<Folder className="h-4 w-4" style={{ color: fo.color || "#6E58F1" }} />}
                selected={f.folderId === fo.id} onClick={() => p.onChange({ folderId: f.folderId === fo.id ? null : fo.id })} />
            ))}
          </Collapsible>

          {(f.status || f.accountId || f.campaignId || moreCount > 0) && (
            <button type="button" onClick={() => p.onChange({ status: null, accountId: null, campaignId: null, unreadOnly: false, importantOnly: false, folderId: null })}
              className="m-press mt-4 w-full rounded-[12px] py-3 text-center text-[15px] font-semibold text-[#4D6CF3]">
              Quitar filtros
            </button>
          )}
        </div>
      </aside>
    </div>
  );
}

function Collapsible({ icon, label, active, badge, open, onToggle, children }: {
  icon: ReactNode; label: string; active?: boolean; badge?: number; open: boolean; onToggle: () => void; children: ReactNode;
}) {
  return (
    <div className={`mt-3.5 overflow-hidden rounded-[14px] border bg-white ${active ? "border-[#C9D4FA]" : "border-[#EDEFF5]"}`}>
      <button type="button" onClick={onToggle} className="m-press flex h-[52px] w-full items-center gap-3.5 pl-2.5 pr-3.5 text-left">
        <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[9px] bg-[#EFEBFD] text-[#6E58F1]">{icon}</span>
        <span className="min-w-0 flex-1 truncate text-[16px] font-semibold text-[#0E1330]">{label}</span>
        {badge ? <span className="flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-[#E9EEFE] px-1.5 text-[12px] font-semibold text-[#3159E3]">{badge}</span> : null}
        <ChevronDown className={`h-[18px] w-[18px] shrink-0 text-[#5B6283] transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="m-fade-in max-h-[300px] overflow-y-auto border-t border-[#F0F2F7] px-1.5 py-2">{children}</div>}
    </div>
  );
}

function Option({ label, count, icon, selected, onClick }: { label: string; count?: number; icon?: ReactNode; selected: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className={`m-press flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2.5 text-left ${selected ? "bg-[#EEF2FE]" : "active:bg-[#F4F6FB]"}`}>
      {icon && <span className="flex w-5 shrink-0 justify-center">{icon}</span>}
      <span className={`min-w-0 flex-1 truncate text-[14.5px] ${selected ? "font-semibold text-[#2E4FD6]" : "text-[#1B2140]"}`}>{label}</span>
      {typeof count === "number" && <span className="shrink-0 text-[12.5px] text-[#7A809B]">{count}</span>}
      {selected && <Check className="h-4 w-4 shrink-0 text-[#3B6CF6]" />}
    </button>
  );
}
