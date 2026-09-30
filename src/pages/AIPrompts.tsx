import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ArrowRight, Circle, Inbox, Layers, LayoutGrid, List, Mail, MessageSquareReply, MoreHorizontal, PenLine,
  Pencil, Plus, ScrollText, Search, Send, Sparkles, Tag, Trash2, Pause, Play,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirm } from "@/hooks/useConfirm";
import { toast } from "sonner";
import { ReplyAgentEditor, type CampaignOption } from "@/components/reply-agent/ReplyAgentEditor";
import { ReplyAgentLog } from "@/components/reply-agent/ReplyAgentLog";
import { rowToAgent } from "@/components/reply-agent/ReplyAgentTab";
import type { ReplyAgent } from "@/components/reply-agent/types";
import {
  DIAS_GRAFICA, curvaActividad, filtrarAgentes, tarjetasAsistente, tarjetasRespuesta,
  type AgentCard, type AgentKind, type AgentStatus, type PromptRow,
} from "@/lib/agents-view";
import { cn } from "@/lib/utils";
import EmptyShowcase from "@/components/EmptyShowcase";

/* Agentes IA (antes "Asistente IA", 30-09-2026) con el diseño del propietario: una tarjeta por
   agente con su estado, etiquetas, la gráfica de su actividad de los últimos 14 días y dos cifras.
   Hay dos tipos reales:
     · Agente de respuestas (auto_reply_rules): contesta o deja borradores cuando un lead responde.
     · Asistente del Unibox (ai_prompts): sugiere respuestas en los buzones con sus etiquetas.
   Todo lo que se enseña sale de la base de datos; nada de cifras de ejemplo. */

const STATUS: Record<AgentStatus, { label: string; cls: string; dot: string }> = {
  active: { label: "Activo", cls: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300", dot: "bg-emerald-500" },
  paused: { label: "Pausado", cls: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300", dot: "bg-amber-500" },
  draft: { label: "Borrador", cls: "bg-violet-50 text-violet-700 ring-1 ring-violet-200 dark:bg-violet-500/10 dark:text-violet-300 dark:ring-violet-500/30", dot: "" },
};

function kindLook(c: AgentCard) {
  if (c.kind === "assistant") return { Icon: Sparkles, tile: "bg-fuchsia-50 text-fuchsia-600 dark:bg-fuchsia-500/10 dark:text-fuchsia-300", from: "#c084fc", to: "#f472b6", A: Tag, B: Inbox };
  if (c.tags[0] === "Envío automático") return { Icon: Send, tile: "bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-300", from: "#60a5fa", to: "#8b5cf6", A: Mail, B: PenLine };
  return { Icon: MessageSquareReply, tile: "bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-300", from: "#818cf8", to: "#a855f7", A: Mail, B: PenLine };
}

function Sparkline({ card }: { card: AgentCard }) {
  const look = kindLook(card);
  const { line, area, vacia } = curvaActividad(card.series, 300, 56);
  const gid = `ag-${card.id}`;
  return (
    <svg viewBox="0 0 300 56" preserveAspectRatio="none" className="h-14 w-full" aria-label={vacia ? "Sin actividad en los últimos 14 días" : `Actividad de los últimos ${DIAS_GRAFICA} días`}>
      <defs>
        <linearGradient id={`${gid}-l`} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor={look.from} /><stop offset="100%" stopColor={look.to} />
        </linearGradient>
        <linearGradient id={`${gid}-a`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={look.to} stopOpacity=".18" /><stop offset="100%" stopColor={look.to} stopOpacity="0" />
        </linearGradient>
      </defs>
      {!vacia && <path d={area} fill={`url(#${gid}-a)`} />}
      <path d={line} fill="none" stroke={vacia ? "#dfe2ef" : `url(#${gid}-l)`} strokeWidth="2" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function AgentMenu({ card, onEdit, onToggle, onDelete }: { card: AgentCard; onEdit: () => void; onToggle: () => void; onDelete: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label={`Opciones de ${card.name}`} className="grid h-8 w-8 place-items-center rounded-full text-[#6b7196] transition-colors hover:bg-muted hover:text-foreground">
          <MoreHorizontal className="h-5 w-5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onClick={onEdit}><Pencil className="mr-2 h-4 w-4" /> Editar</DropdownMenuItem>
        {card.kind === "reply" && (
          <DropdownMenuItem onClick={onToggle}>
            {card.status === "active" ? <><Pause className="mr-2 h-4 w-4" /> Pausar</> : <><Play className="mr-2 h-4 w-4" /> Activar</>}
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onDelete} className="text-destructive focus:text-destructive"><Trash2 className="mr-2 h-4 w-4" /> Eliminar</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function StatusPill({ status }: { status: AgentStatus }) {
  const s = STATUS[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-medium", s.cls)}>
      {s.dot ? <span className={cn("h-2 w-2 rounded-full", s.dot)} /> : <Circle className="h-2.5 w-2.5" strokeWidth={3} />}
      {s.label}
    </span>
  );
}

const Chip = ({ children }: { children: React.ReactNode }) => (
  <span className="rounded-full bg-[#f3f2fb] px-2.5 py-1 text-[12px] font-medium text-[#5b5f8f] dark:bg-muted dark:text-muted-foreground">{children}</span>
);

/* ── Asistente del Unibox (ai_prompts): crear / editar ─────────────────────────────────── */
function AssistantDialog({ open, onOpenChange, editing, availableTags, onSaved }: {
  open: boolean; onOpenChange: (v: boolean) => void; editing: PromptRow | null; availableTags: string[]; onSaved: () => void;
}) {
  const { user } = useAuth();
  const [name, setName] = useState("");
  const [companyInfo, setCompanyInfo] = useState("");
  const [promptText, setPromptText] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) return;
    setName(editing?.name || ""); setCompanyInfo(editing?.company_info || ""); setPromptText(editing?.prompt || ""); setTags(editing?.tags || []);
  }, [open, editing]);
  const save = async () => {
    if (!user || !name.trim()) { toast.error("Pon un nombre al asistente"); return; }
    setSaving(true);
    const row = { name: name.trim(), company_info: companyInfo, prompt: promptText, tags };
    const { error } = editing
      ? await supabase.from("ai_prompts").update(row).eq("id", editing.id)
      : await supabase.from("ai_prompts").insert({ user_id: user.id, ...row });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(editing ? "Asistente actualizado" : "Asistente creado");
    onOpenChange(false);
    onSaved();
  };
  const toggle = (t: string) => setTags((p) => (p.includes(t) ? p.filter((x) => x !== t) : [...p, t]));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-primary" /> {editing ? "Editar asistente del Unibox" : "Nuevo asistente del Unibox"}</DialogTitle></DialogHeader>
        <p className="text-[13px] text-muted-foreground">Sugiere respuestas en el Unibox para los mensajes que llegan a los buzones con estas etiquetas.</p>
        <div className="space-y-4">
          <div><label className="mb-1.5 block text-sm font-medium">Nombre</label><Input placeholder="Ej: Ventas OnePulso" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><label className="mb-1.5 block text-sm font-medium">Información de la empresa</label><Textarea placeholder="Describe tu empresa, servicios…" className="min-h-[100px] resize-none" value={companyInfo} onChange={(e) => setCompanyInfo(e.target.value)} /></div>
          <div><label className="mb-1.5 block text-sm font-medium">Instrucciones para la IA</label><Textarea placeholder="Ej: Responde profesional y cercana…" className="min-h-[100px] resize-none" value={promptText} onChange={(e) => setPromptText(e.target.value)} /></div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Etiquetas de buzón</label>
            {availableTags.length === 0 ? (
              <p className="text-xs italic text-muted-foreground">No hay etiquetas en tus cuentas de email.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {availableTags.map((t) => (
                  <button key={t} type="button" onClick={() => toggle(t)} className={cn("inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium transition-all", tags.includes(t) ? "border-primary bg-primary text-primary-foreground" : "border-border bg-muted text-muted-foreground hover:bg-muted/80")}>
                    <Tag className="h-3 w-3" />{t}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button onClick={save} disabled={saving} className="gap-2"><Sparkles className="h-4 w-4" />{editing ? "Guardar cambios" : "Crear asistente"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── Página ───────────────────────────────────────────────────────────────────────────── */
export default function AIPrompts() {
  const { user } = useAuth();
  const confirm = useConfirm();
  const [loading, setLoading] = useState(true);
  const [rules, setRules] = useState<ReplyAgent[]>([]);
  const [prompts, setPrompts] = useState<PromptRow[]>([]);
  const [logs, setLogs] = useState<{ rule_id: string | null; status: string; created_at: string }[]>([]);
  const [pendientes, setPendientes] = useState<Record<string, number>>({});
  const [tagCounts, setTagCounts] = useState<Record<string, number>>({});
  const [campaigns, setCampaigns] = useState<CampaignOption[]>([]);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<AgentKind | "all">("all");
  const [status, setStatus] = useState<AgentStatus | "all">("all");
  const [view, setView] = useState<"grid" | "list">(() => { try { return (localStorage.getItem("agents:view") as "grid" | "list") || "grid"; } catch { return "grid"; } });
  const [editingRule, setEditingRule] = useState<ReplyAgent | null>(null);
  const [creatingRule, setCreatingRule] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState<PromptRow | null>(null);
  const [logOpen, setLogOpen] = useState(false);

  useEffect(() => { try { localStorage.setItem("agents:view", view); } catch { /* sin almacenamiento */ } }, [view]);
  useEffect(() => { const prev = document.title; document.title = "Agentes IA · OnePulso"; return () => { document.title = prev; }; }, []);

  const load = useCallback(async () => {
    if (!user) return;
    const desde = new Date(); desde.setDate(desde.getDate() - DIAS_GRAFICA); desde.setHours(0, 0, 0, 0);
    const [r, p, l, d, a, c] = await Promise.all([
      supabase.from("auto_reply_rules").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
      supabase.from("ai_prompts").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
      supabase.from("auto_reply_log").select("rule_id, status, created_at").eq("user_id", user.id).gte("created_at", desde.toISOString()).limit(5000),
      supabase.from("auto_reply_log").select("rule_id").eq("user_id", user.id).eq("status", "draft").limit(5000),
      supabase.from("email_accounts").select("tags").eq("user_id", user.id),
      supabase.from("campaigns").select("id, name, status").eq("user_id", user.id).order("created_at", { ascending: false }),
    ]);
    const err = r.error || p.error || l.error;
    if (err) toast.error(`No se pudieron cargar los agentes: ${err.message}`);
    setRules(((r.data || []) as unknown as Record<string, unknown>[]).map(rowToAgent));
    setPrompts((p.data || []) as PromptRow[]);
    setLogs((l.data || []) as any[]);
    const pend: Record<string, number> = {};
    for (const row of (d.data || []) as { rule_id: string | null }[]) if (row.rule_id) pend[row.rule_id] = (pend[row.rule_id] || 0) + 1;
    setPendientes(pend);
    const tc: Record<string, number> = {};
    for (const acc of (a.data || []) as { tags: string[] | null }[]) for (const t of acc.tags || []) tc[t] = (tc[t] || 0) + 1;
    setTagCounts(tc);
    setCampaigns((c.data || []) as CampaignOption[]);
    setLoading(false);
  }, [user]);
  useEffect(() => { void load(); }, [load]);

  const cards = useMemo(() => [
    ...tarjetasRespuesta(rules, logs, new Date(), pendientes),
    ...tarjetasAsistente(prompts, tagCounts),
  ], [rules, logs, pendientes, prompts, tagCounts]);
  const shown = filtrarAgentes(cards, { q, kind, status });
  const availableTags = useMemo(() => Object.keys(tagCounts).sort((x, y) => x.localeCompare(y)), [tagCounts]);

  const edit = (c: AgentCard) => {
    if (c.kind === "reply") setEditingRule(rules.find((r) => r.id === c.id) || null);
    else { setEditingPrompt(prompts.find((p) => p.id === c.id) || null); setAssistantOpen(true); }
  };
  const toggle = async (c: AgentCard) => {
    const rule = rules.find((r) => r.id === c.id);
    if (!rule) return;
    const { error } = await supabase.from("auto_reply_rules").update({ is_active: !rule.is_active }).eq("id", rule.id);
    if (error) { toast.error(error.message); return; }
    toast.success(rule.is_active ? "Agente pausado" : "Agente activado");
    void load();
  };
  const remove = async (c: AgentCard) => {
    const ok = await confirm({
      title: `¿Eliminar "${c.name}"?`,
      description: c.kind === "reply" ? "Dejará de redactar y responder. No se puede deshacer." : "Dejará de sugerir respuestas en el Unibox. No se puede deshacer.",
      confirmText: "Eliminar",
      destructive: true,
    });
    if (!ok) return;
    const { error } = await supabase.from(c.kind === "reply" ? "auto_reply_rules" : "ai_prompts").delete().eq("id", c.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Agente eliminado");
    void load();
  };

  // Crear / editar un agente de respuestas ocupa la página entera (su editor tiene muchos pasos).
  if (editingRule || creatingRule) {
    return (
      <ReplyAgentEditor
        agent={editingRule}
        campaigns={campaigns}
        availableTags={availableTags}
        onClose={() => { setEditingRule(null); setCreatingRule(false); }}
        onSaved={() => { setEditingRule(null); setCreatingRule(false); void load(); }}
      />
    );
  }

  const filtering = !!q.trim() || kind !== "all" || status !== "all";

  return (
    <div className="space-y-6">
      {/* Cabecera */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-[clamp(28px,3vw,38px)] font-semibold tracking-[-0.03em] text-[#0b1040] dark:text-foreground">Agentes IA</h1>
          <p className="mt-1 text-[15.5px] text-[#6470a8] dark:text-muted-foreground">Crea, gestiona y activa agentes inteligentes que responden y atienden a tus leads.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <button type="button" onClick={() => setLogOpen(true)}
            className="inline-flex h-11 items-center gap-2 rounded-[14px] border border-[#e3e6f2] bg-card px-4 text-[14.5px] font-medium text-[#3b3f8f] transition-colors hover:border-primary/50 dark:border-border dark:text-foreground">
            <ScrollText className="h-[18px] w-[18px] text-primary" /> Registro de actividad
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="inline-flex h-11 items-center gap-2 rounded-[14px] bg-gradient-to-r from-[#6a4cff] to-[#7b5cff] px-5 text-[15px] font-semibold text-white shadow-[0_8px_20px_rgba(106,76,255,.35)] transition hover:brightness-110">
                <Plus className="h-5 w-5" /> Crear agente
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72 p-1.5">
              <DropdownMenuItem onClick={() => setCreatingRule(true)} className="items-start gap-3 py-2.5">
                <MessageSquareReply className="mt-0.5 h-5 w-5 text-violet-600" />
                <span><span className="block font-semibold">Agente de respuestas</span><span className="block text-[12px] text-muted-foreground">Contesta o te deja borradores cuando un lead responde</span></span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { setEditingPrompt(null); setAssistantOpen(true); }} className="items-start gap-3 py-2.5">
                <Sparkles className="mt-0.5 h-5 w-5 text-fuchsia-600" />
                <span><span className="block font-semibold">Asistente del Unibox</span><span className="block text-[12px] text-muted-foreground">Sugiere respuestas en los buzones con sus etiquetas</span></span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Buscar y filtrar */}
      <div className="flex flex-wrap items-center gap-2.5">
        <label className="flex h-12 min-w-[220px] flex-1 items-center gap-2.5 rounded-[14px] border border-[#e3e6f2] bg-card px-4 focus-within:border-primary/60 dark:border-border sm:max-w-[370px]">
          <Search className="h-[18px] w-[18px] text-[#8a91b4]" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar agentes…" className="h-full w-full bg-transparent text-[15px] outline-none placeholder:text-[#9aa0c2]" />
        </label>
        <Select value={kind} onValueChange={(v) => setKind(v as AgentKind | "all")}>
          <SelectTrigger className="h-12 w-[calc(50%-5px)] justify-start sm:w-[210px] gap-2 rounded-[14px] border-[#e3e6f2] bg-card text-[14.5px] dark:border-border [&>svg:last-child]:ml-auto"><Layers className="h-4 w-4 shrink-0 text-[#6b7196]" /><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los tipos</SelectItem>
            <SelectItem value="reply">Agentes de respuestas</SelectItem>
            <SelectItem value="assistant">Asistentes del Unibox</SelectItem>
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(v) => setStatus(v as AgentStatus | "all")}>
          <SelectTrigger className="h-12 w-[calc(50%-5px)] justify-start sm:w-[200px] gap-2 rounded-[14px] border-[#e3e6f2] bg-card text-[14.5px] dark:border-border [&>svg:last-child]:ml-auto"><Circle className="h-4 w-4 shrink-0 text-[#6b7196]" /><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los estados</SelectItem>
            <SelectItem value="active">Activos</SelectItem>
            <SelectItem value="paused">Pausados</SelectItem>
            <SelectItem value="draft">Borradores</SelectItem>
          </SelectContent>
        </Select>
        <div className="ml-auto hidden rounded-[14px] border border-[#e3e6f2] bg-card p-1 dark:border-border sm:flex">
          {([["grid", LayoutGrid, "Ver en tarjetas"], ["list", List, "Ver en lista"]] as const).map(([v, Icon, label]) => (
            <button key={v} type="button" title={label} aria-label={label} aria-pressed={view === v} onClick={() => setView(v)}
              className={cn("grid h-9 w-11 place-items-center rounded-[10px] transition-colors", view === v ? "bg-[#efedff] text-primary dark:bg-primary/15" : "text-[#6b7196] hover:text-foreground")}>
              <Icon className="h-[18px] w-[18px]" />
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton-shimmer h-[300px] rounded-[20px] bg-muted/60" />)}
        </div>
      ) : cards.length === 0 ? (
        <EmptyShowcase
          variant="agents"
          title="Aún no tienes agentes"
          text="Crea tu primer agente de IA y deja que conteste a tus leads por ti, con tu objetivo y tu tono."
          cta={{ label: "Crear agente", onClick: () => setCreatingRule(true) }}
          secondary={
            <button type="button" onClick={() => { setEditingPrompt(null); setAssistantOpen(true); }} className="font-semibold text-primary hover:underline">
              o crea un asistente que sugiera respuestas en el Unibox
            </button>
          }
        />
      ) : shown.length === 0 && filtering ? (
        <div className="rounded-[20px] border border-dashed border-border px-6 py-14 text-center text-[15px] text-muted-foreground">Ningún agente coincide con la búsqueda.</div>
      ) : view === "grid" ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {shown.map((c) => {
            const look = kindLook(c);
            return (
              <article key={c.id} className="chip-pop flex flex-col rounded-[20px] border border-[#eceef7] bg-card p-5 shadow-[0_10px_30px_rgba(82,94,170,.06)] transition-shadow hover:shadow-[0_14px_36px_rgba(82,94,170,.12)] dark:border-border">
                <div className="flex items-center gap-3">
                  <span className={cn("grid h-12 w-12 shrink-0 place-items-center rounded-[16px]", look.tile)}><look.Icon className="h-6 w-6" strokeWidth={1.8} /></span>
                  <StatusPill status={c.status} />
                  <span className="ml-auto"><AgentMenu card={c} onEdit={() => edit(c)} onToggle={() => void toggle(c)} onDelete={() => void remove(c)} /></span>
                </div>
                <h3 className="mt-4 font-display text-[17.5px] font-semibold tracking-[-0.02em] text-[#0b1040] dark:text-foreground">{c.name}</h3>
                <p className="mt-1 line-clamp-2 min-h-[42px] text-[14px] leading-[1.5] text-[#6470a8] dark:text-muted-foreground">{c.description}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">{c.tags.map((t) => <Chip key={t}>{t}</Chip>)}</div>
                <div className="mt-4"><Sparkline card={c} /></div>
                <div className="mt-3 flex items-center gap-3 border-t border-[#eef0f8] pt-3 dark:border-border">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 text-[16px] font-semibold tabular-nums text-[#0b1040] dark:text-foreground"><look.A className="h-4 w-4 text-primary" /> {c.metricA.value.toLocaleString("es-ES")}</p>
                    <p className="truncate pl-[22px] text-[12.5px] text-[#7c84ad]">{c.metricA.label}</p>
                  </div>
                  <span className="h-8 w-px bg-[#eef0f8] dark:bg-border" />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 text-[16px] font-semibold tabular-nums text-[#0b1040] dark:text-foreground"><look.B className="h-4 w-4 text-emerald-500" /> {c.metricB.value.toLocaleString("es-ES")}</p>
                    <p className="truncate pl-[22px] text-[12.5px] text-[#7c84ad]">{c.metricB.label}</p>
                  </div>
                  <button type="button" onClick={() => edit(c)} aria-label={`Abrir ${c.name}`} title="Abrir y configurar"
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[#e3e6f2] text-primary transition-colors hover:bg-primary hover:text-white dark:border-border">
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </div>
              </article>
            );
          })}
          {!filtering && (
            <button type="button" onClick={() => setCreatingRule(true)}
              className="flex min-h-[300px] flex-col items-center justify-center gap-3 rounded-[20px] border-2 border-dashed border-[#dcd8f7] bg-card/50 p-6 text-center transition-colors hover:border-primary/60 hover:bg-primary/5 dark:border-border">
              <span className="grid h-14 w-14 place-items-center rounded-[18px] bg-violet-50 text-primary dark:bg-primary/15"><Plus className="h-7 w-7" /></span>
              <span className="font-display text-[17px] font-semibold text-[#0b1040] dark:text-foreground">Crear agente</span>
              <span className="max-w-[220px] text-[13.5px] text-[#6470a8] dark:text-muted-foreground">Un agente que conteste a tus leads por ti, con tu objetivo y tu tono.</span>
            </button>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-[20px] border border-[#eceef7] bg-card dark:border-border">
          {shown.length === 0 && <p className="px-6 py-10 text-center text-[14.5px] text-muted-foreground">Todavía no tienes agentes. Crea el primero con "Crear agente".</p>}
          {shown.map((c, i) => {
            const look = kindLook(c);
            return (
              <div key={c.id} className={cn("flex flex-wrap items-center gap-4 px-5 py-4", i > 0 && "border-t border-[#eef0f8] dark:border-border")}>
                <span className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-[14px]", look.tile)}><look.Icon className="h-5 w-5" strokeWidth={1.8} /></span>
                <div className="min-w-[200px] flex-1">
                  <p className="font-display text-[16px] font-semibold text-[#0b1040] dark:text-foreground">{c.name}</p>
                  <p className="line-clamp-1 text-[13.5px] text-[#6470a8] dark:text-muted-foreground">{c.description}</p>
                </div>
                <StatusPill status={c.status} />
                <div className="hidden w-[190px] lg:block"><Sparkline card={c} /></div>
                <div className="w-[120px] text-[13px] text-[#7c84ad]"><b className="block text-[15px] tabular-nums text-foreground">{c.metricA.value.toLocaleString("es-ES")}</b>{c.metricA.label}</div>
                <div className="w-[100px] text-[13px] text-[#7c84ad]"><b className="block text-[15px] tabular-nums text-foreground">{c.metricB.value.toLocaleString("es-ES")}</b>{c.metricB.label}</div>
                <AgentMenu card={c} onEdit={() => edit(c)} onToggle={() => void toggle(c)} onDelete={() => void remove(c)} />
              </div>
            );
          })}
        </div>
      )}

      <AssistantDialog open={assistantOpen} onOpenChange={setAssistantOpen} editing={editingPrompt} availableTags={availableTags} onSaved={() => void load()} />

      <Dialog open={logOpen} onOpenChange={setLogOpen}>
        <DialogContent className="max-h-[88vh] max-w-4xl overflow-y-auto">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><ScrollText className="h-5 w-5 text-primary" /> Registro de actividad de los agentes</DialogTitle></DialogHeader>
          <ReplyAgentLog />
        </DialogContent>
      </Dialog>
    </div>
  );
}
