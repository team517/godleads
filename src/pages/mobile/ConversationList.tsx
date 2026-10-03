import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import { Search, Settings2, X } from "lucide-react";
import { listDate, type Conversation, type LeadStatus, type MobileFilters } from "@/lib/mobile-inbox";
import { Avatar, StatusPill, Waves } from "./ui";
import { EmptyIllustration } from "./EmptyIllustration";

interface Props {
  items: Conversation[];
  statusOf: (c: Conversation) => LeadStatus;
  filters: MobileFilters;
  activeFilterCount: number;
  loading: boolean;
  refreshing: boolean;
  onSearch: (q: string) => void;
  onTab: (t: "primary" | "others") => void;
  onOpenFilters: () => void;
  onOpen: (c: Conversation) => void;
  onRefresh: () => Promise<void> | void;
  /** Aviso opcional arriba de la lista (activar notificaciones). */
  banner?: ReactNode;
}

const CHUNK = 60;

export function ConversationList(p: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [limit, setLimit] = useState(CHUNK);
  const endRef = useRef<HTMLDivElement>(null);

  // Al cambiar de pestaña o de filtros, arriba del todo y otra vez por tramos.
  useEffect(() => {
    setLimit(CHUNK);
    scrollRef.current?.scrollTo({ top: 0 });
  }, [p.filters.tab, p.filters.status, p.filters.accountId, p.filters.campaignId, p.filters.unreadOnly, p.filters.importantOnly, p.filters.folderId]);

  useEffect(() => {
    const el = endRef.current;
    if (!el || p.items.length <= limit) return;
    const io = new IntersectionObserver((e) => {
      if (e.some((x) => x.isIntersecting)) setLimit((l) => Math.min(p.items.length, l + CHUNK));
    }, { root: scrollRef.current, rootMargin: "800px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [p.items.length, limit]);

  /* Tirar hacia abajo para actualizar (en la app instalada no hay botón de recargar). */
  const pull = useRef<{ y: number; active: boolean }>({ y: 0, active: false });
  const [pullPx, setPullPx] = useState(0);
  const [pulling, setPulling] = useState(false);
  const TRIGGER = 72;
  const onTouchStart = (e: React.TouchEvent) => {
    if ((scrollRef.current?.scrollTop || 0) <= 0) pull.current = { y: e.touches[0].clientY, active: true };
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (!pull.current.active) return;
    const d = e.touches[0].clientY - pull.current.y;
    if (d <= 0) { setPullPx(0); return; }
    setPullPx(Math.min(110, d * 0.5));
  };
  const onTouchEnd = async () => {
    if (!pull.current.active) return;
    pull.current.active = false;
    if (pullPx >= TRIGGER * 0.75) {
      setPulling(true);
      setPullPx(56);
      try { await p.onRefresh(); } finally { setPulling(false); setPullPx(0); }
    } else {
      setPullPx(0);
    }
  };

  const tab = p.filters.tab;
  const shown = p.items.length > limit ? p.items.slice(0, limit) : p.items;

  return (
    <div className="flex h-full flex-col">
      {/* Filtros + buscador */}
      <div className="flex items-center gap-3 px-4 pb-1 pt-[calc(14px+env(safe-area-inset-top))]">
        <button type="button" aria-label="Filtros" onClick={p.onOpenFilters}
          className="m-press m-field relative flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-[13px] text-[#3A4163]">
          <Settings2 className="h-[21px] w-[21px]" strokeWidth={1.9} />
          {p.activeFilterCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#4D6CF3] px-1 text-[10.5px] font-semibold text-white">
              {p.activeFilterCount}
            </span>
          )}
        </button>
        <label className="m-field flex h-[46px] min-w-0 flex-1 items-center gap-2.5 rounded-[13px] px-3.5">
          <Search className="h-[19px] w-[19px] shrink-0 text-[#5B6283]" strokeWidth={2} />
          <input
            value={p.filters.search}
            onChange={(e) => p.onSearch(e.target.value)}
            placeholder="Buscar contactos..."
            inputMode="search"
            enterKeyHint="search"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="h-full min-w-0 flex-1 bg-transparent text-[16px] text-[#0E1330] outline-none placeholder:text-[#8A90AC]"
          />
          {p.filters.search && (
            <button type="button" aria-label="Borrar búsqueda" onClick={() => p.onSearch("")}
              className="m-press flex h-6 w-6 items-center justify-center rounded-full bg-[#EEF0F6] text-[#6B7192]">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </label>
      </div>

      {/* Pestañas */}
      <div className="relative mt-2 flex border-b border-[#E7EAF2]">
        {(["primary", "others"] as const).map((t) => (
          <button key={t} type="button" onClick={() => p.onTab(t)}
            className={`flex-1 pb-3 pt-2.5 text-center text-[16.5px] font-semibold transition-colors ${tab === t ? (t === "primary" ? "m-tab-active-primary" : "m-tab-active-others") : "text-[#6B7192]"}`}>
            {t === "primary" ? "Primary" : "Others"}
          </button>
        ))}
        <span className="pointer-events-none absolute bottom-[-1px] left-0 flex w-1/2 justify-center px-4"
          style={{ transform: `translateX(${tab === "primary" ? 0 : 100}%)`, transition: "transform 260ms cubic-bezier(.2,.8,.2,1)" }}>
          <span className="m-tab-bar block h-[3px] w-full" />
        </span>
      </div>

      {/* Lista */}
      <div
        ref={scrollRef}
        className="m-scroll relative min-h-0 flex-1"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <div className="m-ptr flex items-end justify-center overflow-hidden" style={{ height: pullPx }}>
          <span className={`mb-3 h-6 w-6 rounded-full border-[2.5px] border-[#C9D2F6] border-t-[#4D6CF3] ${pulling || p.refreshing ? "m-spin" : ""}`}
            style={{ transform: pulling ? undefined : `rotate(${pullPx * 4}deg)`, opacity: Math.min(1, pullPx / 40) }} />
        </div>
        {p.banner}

        {p.loading && p.items.length === 0 ? (
          <div className="space-y-3 px-3 pt-3">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="m-card flex gap-3.5 rounded-[18px] p-4">
                <span className="m-skeleton h-10 w-10 shrink-0 rounded-full" />
                <div className="flex-1 space-y-2.5 pt-1">
                  <span className="m-skeleton block h-3.5 w-1/2 rounded" />
                  <span className="m-skeleton block h-3.5 w-4/5 rounded" />
                  <span className="m-skeleton block h-3 w-full rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : p.items.length === 0 ? (
          <EmptyState tab={tab} searching={!!p.filters.search.trim() || p.activeFilterCount > 0} />
        ) : (
          <div className="space-y-[10px] px-2.5 pb-6 pt-3">
            {shown.map((c) => (
              <Row key={c.key} c={c} status={p.statusOf(c)} onOpen={p.onOpen} />
            ))}
            <div ref={endRef} className="h-px" />
          </div>
        )}
      </div>
    </div>
  );
}

const Row = memo(function Row({ c, status, onOpen }: { c: Conversation; status: LeadStatus; onOpen: (c: Conversation) => void }) {
  const unread = c.unreadIds.length > 0;
  return (
    <button type="button" onClick={() => onOpen(c)}
      className="m-row m-card m-press flex w-full gap-3 rounded-[18px] pb-4 pl-3 pr-3 pt-[15px] text-left active:bg-[#FAFBFE]">
      <Avatar name={c.name} size={40} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-[7px]">
          <span className="min-w-[3.5em] truncate text-[15px] text-[#1B2140]">{c.name}</span>
          <StatusPill status={status} />
          <span className="ml-auto shrink-0 pl-0.5 text-[12px] text-[#7C819A]">{listDate(c.receivedAt)}</span>
          <span className={`h-2 w-2 shrink-0 rounded-full ${unread ? "bg-[#2F6BEA]" : "bg-transparent"}`} />
        </span>
        <span className={`mt-[7px] block text-[16px] leading-[1.3] text-[#0E1330] [overflow-wrap:anywhere] ${unread ? "font-bold" : "font-semibold"}`}>
          {c.subject}
        </span>
        {c.preview && (
          <span className="mt-1 line-clamp-2 text-[15px] leading-[1.42] text-[#6E7491] [overflow-wrap:anywhere]">
            {c.preview}
          </span>
        )}
      </span>
    </button>
  );
});

function EmptyState({ tab, searching }: { tab: "primary" | "others"; searching: boolean }) {
  return (
    <div className="m-fade-in relative flex min-h-full flex-col items-center px-6 pb-10 pt-[9vh] text-center">
      <Waves className="absolute inset-x-0 bottom-0 h-[38%] w-full" />
      <EmptyIllustration className="relative w-full max-w-[330px]" />
      <h2 className="relative mt-8 text-[21px] font-bold tracking-[-0.01em] text-[#0E1330]">No se encontraron contactos</h2>
      <p className="relative mt-2 max-w-[290px] text-[15.5px] leading-[1.45] text-[#6E7491]">
        {tab === "primary"
          ? "Intenta ajustar tu búsqueda o revisa en la pestaña Others."
          : searching ? "Intenta ajustar tu búsqueda o revisa en la pestaña Primary." : "Aquí llega el correo que no es de ninguna campaña."}
      </p>
    </div>
  );
}
