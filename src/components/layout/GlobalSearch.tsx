import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Loader2, Send, Users, Mail, Inbox, LayoutDashboard, BarChart3, ShieldCheck, Brain, Workflow, Tv, CornerDownLeft } from "lucide-react";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

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
  { label: "IA", path: "/ai-prompts", keywords: "ia ai prompts inteligencia", icon: Brain },
  { label: "Nodos", path: "/workflows", keywords: "nodos workflows automatizacion flujos", icon: Workflow },
  { label: "Tutorial", path: "/godtube", keywords: "tutorial ayuda godtube videos", icon: Tv },
];

const KIND_META: Record<ResultKind, { icon: any; label: string }> = {
  page: { icon: CornerDownLeft, label: "Ir a" },
  campaign: { icon: Send, label: "Campaña" },
  lead: { icon: Users, label: "Lead" },
  account: { icon: Mail, label: "Cuenta" },
};

export function GlobalSearch() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
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
    const navMatches: SearchResult[] = NAV
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
  }, [user]);

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
    <div ref={boxRef} className="relative w-80">
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => { if (query.trim()) setOpen(true); }}
        onKeyDown={onKeyDown}
        placeholder="Buscar campañas, leads, correos..."
        className="pl-10 pr-9 bg-white/95 text-foreground placeholder:text-muted-foreground border-0"
      />
      {loading && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />}

      {open && query.trim() && (
        <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-xl">
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
                        <span className="block truncate text-sm font-medium text-foreground">{r.title}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">{r.subtitle}</span>
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
