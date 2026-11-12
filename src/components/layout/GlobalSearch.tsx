import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Loader2, Send, Users, Mail, Inbox, LayoutDashboard, BarChart3, ShieldCheck, Brain, Rocket, Bot, CornerDownLeft, CalendarHeart } from "lucide-react";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { puedeVerIaMod } from "@/lib/ia-mod-view";
import { useFunnyTeamAccess } from "@/hooks/useFunnyTeamAccess";

type ResultKind = "page" | "campaign" | "lead" | "account";
interface SearchResult {
  kind: ResultKind;
  id: string;
  title: string;
  subtitle?: string;
  to: string;
}

// Static navigation targets so typing "leads", "unibox"… jumps to the section.
const NAV: { label: string; path: string; keywords: string; icon: any }[] = [
  { label: "Dashboard", path: "/dashboard", keywords: "dashboard inicio panel resumen", icon: LayoutDashboard },
  { label: "Cuentas Email", path: "/email-accounts", keywords: "cuentas email correos buzones smtp", icon: Mail },
  { label: "Campañas", path: "/campaigns", keywords: "campanas campaigns secuencias envios", icon: Send },
  { label: "Leads", path: "/leads", keywords: "leads contactos base datos", icon: Users },
  { label: "Unibox", path: "/unibox", keywords: "unibox bandeja mensajes respuestas inbox", icon: Inbox },
  { label: "Estadísticas", path: "/stats", keywords: "estadisticas stats metricas analytics", icon: BarChart3 },
  { label: "Entregabilidad", path: "/deliverability", keywords: "entregabilidad deliverability spam dkim", icon: ShieldCheck },
  { label: "Agentes IA", path: "/ai-prompts", keywords: "agentes ia ai prompts inteligencia respuestas asistente", icon: Brain },
  { label: "Onboarding", path: "/onboarding", keywords: "onboarding clientes progreso fases alta acceso", icon: Rocket },
  { label: "Funny Team", path: "/funny-team", keywords: "funny team equipo reunion reunión agendar reservar cita llamada videollamada ayuda soporte calendario", icon: CalendarHeart },
  { label: "Mensajes del chat", path: "/peticiones", keywords: "mensajes chat en directo clientes responder peticiones hablar equipo contactos demo solicitudes conversaciones historial", icon: Bot },
  { label: "Modificaciones IA", path: "/modificaciones-ia", keywords: "modificaciones ia pulsebot chat cliente mensajes variantes secuencia metricas campana automatizar", icon: Bot },
];

const KIND_META: Record<ResultKind, { icon: any; label: string }> = {
  page: { icon: CornerDownLeft, label: "Ir a" },
  campaign: { icon: Send, label: "Campaña" },
  lead: { icon: Users, label: "Lead" },
  account: { icon: Mail, label: "Cuenta" },
};

export function GlobalSearch() {
  const { user } = useAuth();
  const { allowed: funnyTeamAllowed } = useFunnyTeamAccess();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);

  // Atajo Ctrl/⌘ + K: salta al buscador desde cualquier pantalla.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const reqIdRef = useRef(0);

  // Close on outside click
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const runSearch = useCallback(async (q: string) => {
    const term = q.trim();
    const reqId = ++reqIdRef.current;
    if (!term) { setResults([]); setLoading(false); return; }

    // Nav matches first (instant, no network).
    const lower = term.toLowerCase();
    const isOwner = (user?.email || "").toLowerCase() === "hello@onepulso.blog";
    const OWNER_ONLY = new Set(["/onboarding"]);
    const navMatches: SearchResult[] = NAV
      .filter((n) => !OWNER_ONLY.has(n.path) || isOwner) // owner-only agency tools
      .filter((n) => n.path !== "/modificaciones-ia" || puedeVerIaMod(user?.email))
      .filter((n) => n.path !== "/funny-team" || funnyTeamAllowed)
      .filter((n) => n.label.toLowerCase().includes(lower) || n.keywords.includes(lower))
      .slice(0, 4)
      .map((n) => ({ kind: "page", id: n.path, title: n.label, subtitle: "Sección", to: n.path }));

    setLoading(true);
    let dataMatches: SearchResult[] = [];
    try {
      if (user) {
        const like = `%${term.replace(/[%_]/g, "")}%`;
        const [camps, leads, accts] = await Promise.all([
          supabase.from("campaigns").select("id, name").eq("user_id", user.id).ilike("name", like).limit(5),
          supabase.from("leads").select("id, email").eq("user_id", user.id).ilike("email", like).limit(6),
          supabase.from("email_accounts").select("id, email").eq("user_id", user.id).ilike("email", like).limit(4),
        ]);
        dataMatches = [
          ...(camps.data || []).map((c: any) => ({ kind: "campaign" as const, id: c.id, title: c.name || "(sin nombre)", subtitle: "Campaña", to: `/campaigns?q=${encodeURIComponent(c.name || "")}` })),
          ...(leads.data || []).map((l: any) => ({ kind: "lead" as const, id: l.id, title: l.email, subtitle: "Lead", to: `/leads?q=${encodeURIComponent(l.email)}` })),
          ...(accts.data || []).map((a: any) => ({ kind: "account" as const, id: a.id, title: a.email, subtitle: "Cuenta de envío", to: `/email-accounts?q=${encodeURIComponent(a.email)}` })),
        ];
      }
    } catch { /* ignore — show whatever we have */ }

    // Ignore stale responses (user kept typing).
    if (reqId !== reqIdRef.current) return;
    setResults([...navMatches, ...dataMatches]);
    setActiveIdx(0);
    setLoading(false);
  }, [user, funnyTeamAllowed]);

  // Debounce the query.
  useEffect(() => {
    if (!query.trim()) { setResults([]); setLoading(false); return; }
    setOpen(true);
    const t = setTimeout(() => runSearch(query), 220);
    return () => clearTimeout(t);
  }, [query, runSearch]);

  const go = (r: SearchResult) => {
    setOpen(false);
    setQuery("");
    setResults([]);
    navigate(r.to);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open || results.length === 0) {
      if (e.key === "Enter" && results[0]) go(results[0]);
      return;
    }
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (results[activeIdx]) go(results[activeIdx]); }
    else if (e.key === "Escape") { setOpen(false); }
  };

  return (
    <div ref={boxRef} className="group relative w-full min-w-[180px]">
      <Search className="pointer-events-none absolute left-3.5 top-1/2 z-10 h-[18px] w-[18px] -translate-y-1/2 text-[#3b3f6b] transition-colors group-focus-within:text-primary dark:text-white/60" />
      {/* El propio Input ya trae la superficie de campo del diseño (clara y oscura);
          aquí solo se ajusta el espacio para la lupa y el spinner. */}
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => { if (query.trim()) setOpen(true); }}
        onKeyDown={onKeyDown}
        ref={inputRef}
        placeholder="Buscar campañas, leads, correos..."
        aria-keyshortcuts={isMac ? "Meta+K" : "Control+K"}
        className="h-10 rounded-full border-[#e6e3f3] bg-white/95 pl-11 pr-16 text-[14px] text-foreground shadow-[0_1px_2px_rgba(16,24,64,.05)] placeholder:text-[#6470a8] transition-colors hover:border-primary/40 focus-visible:border-primary focus-visible:ring-primary/20 dark:border-border dark:bg-background/80 dark:placeholder:text-muted-foreground"
      />
      {loading
        ? <Loader2 className="absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        : !query && <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md bg-[#f1eefe] px-1.5 py-0.5 font-sans text-[11px] font-semibold text-primary dark:bg-white/10">{isMac ? "⌘ K" : "Ctrl K"}</kbd>}

      {open && query.trim() && (
        <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-float">
          {results.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">
              {loading ? "Buscando…" : "Sin resultados"}
            </div>
          ) : (
            <ul className="max-h-[380px] overflow-y-auto py-1.5">
              {results.map((r, i) => {
                const Icon = KIND_META[r.kind].icon;
                const isActive = i === activeIdx;
                return (
                  <li key={`${r.kind}-${r.id}-${i}`}>
                    <button
                      type="button"
                      onMouseEnter={() => setActiveIdx(i)}
                      onClick={() => go(r)}
                      className={`flex w-full items-center gap-3 px-3 py-2 text-left transition-colors ${isActive ? "bg-primary/10" : "hover:bg-muted/60"}`}
                    >
                      <span className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md ${isActive ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-semibold text-foreground">{r.title}</span>
                        <span className="block truncate text-[12.5px] text-muted-foreground">{r.subtitle}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
