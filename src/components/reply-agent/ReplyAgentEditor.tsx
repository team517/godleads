import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  ArrowLeft,
  Bot,
  Check,
  ChevronDown,
  Clock,
  Crosshair,
  Info,
  Layers,
  Link2,
  ListFilter,
  Loader2,
  Megaphone,
  Pencil,
  Plus,
  Plug,
  Save,
  Tag,
  Trash2,
  Type,
  UserCheck,
  X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirm } from "@/hooks/useConfirm";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { SelectableCard } from "./SelectableCard";
import {
  agentToDraft,
  emptyAgentDraft,
  GOAL_LABELS,
  LENGTH_OPTIONS,
  MAX_CONTEXT_CHARS,
  NEVER_REPLY_CATEGORIES,
  REPLYABLE_CATEGORIES,
  TONE_OPTIONS,
  validateAgentDraft,
  type CategoryMode,
  type PrimaryGoal,
  type ReplyAgent,
  type ReplyAgentDraft,
  type ReplyLength,
  type ReplyMode,
  type ScopeType,
  type Tone,
} from "./types";

export interface CampaignOption {
  id: string;
  name: string;
  status: string;
}

const SECTIONS = [
  { key: "goal", label: "Objetivo y alcance", icon: Crosshair },
  { key: "categories", label: "Categorías de lead", icon: ListFilter },
  { key: "mode", label: "Modo de respuesta", icon: Bot },
  { key: "tone", label: "Tono y longitud", icon: Type },
  { key: "context", label: "Contexto y guía", icon: Layers },
  { key: "integrations", label: "Integraciones", icon: Plug },
] as const;

type SectionKey = (typeof SECTIONS)[number]["key"];

const STATUS_LABELS: Record<string, string> = {
  active: "Activa",
  paused: "Pausada",
  draft: "Borrador",
  completed: "Completada",
  stopped: "Detenida",
};

function CounterTextarea({
  label,
  hint,
  value,
  onChange,
  placeholder,
  rows = 5,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium">{label}</label>
      {hint && <p className="mb-2 text-xs text-muted-foreground">{hint}</p>}
      <Textarea
        value={value}
        placeholder={placeholder}
        rows={rows}
        maxLength={MAX_CONTEXT_CHARS}
        onChange={(e) => onChange(e.target.value.slice(0, MAX_CONTEXT_CHARS))}
        className="resize-y"
      />
      <p className="mt-1 text-right text-[11px] text-muted-foreground">
        {value.length} / {MAX_CONTEXT_CHARS}
      </p>
    </div>
  );
}

export function ReplyAgentEditor({
  agent,
  campaigns,
  availableTags,
  onClose,
  onSaved,
}: {
  agent: ReplyAgent | null;
  campaigns: CampaignOption[];
  availableTags: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { user } = useAuth();
  const confirm = useConfirm();
  const [draft, setDraft] = useState<ReplyAgentDraft>(() => (agent ? agentToDraft(agent) : emptyAgentDraft()));
  const [section, setSection] = useState<SectionKey>("goal");
  const [editingName, setEditingName] = useState(!agent);
  const [saving, setSaving] = useState(false);
  const [campaignSearch, setCampaignSearch] = useState("");
  const [campaignOpen, setCampaignOpen] = useState(false);
  const [categoryOpen, setCategoryOpen] = useState(false);

  const set = <K extends keyof ReplyAgentDraft>(key: K, value: ReplyAgentDraft[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  const campaignById = useMemo(() => {
    const map: Record<string, CampaignOption> = {};
    campaigns.forEach((c) => { map[c.id] = c; });
    return map;
  }, [campaigns]);

  const filteredCampaigns = useMemo(() => {
    const q = campaignSearch.trim().toLowerCase();
    return q ? campaigns.filter((c) => c.name.toLowerCase().includes(q)) : campaigns;
  }, [campaigns, campaignSearch]);

  const toggleCampaign = (id: string) =>
    set("campaign_ids", draft.campaign_ids.includes(id)
      ? draft.campaign_ids.filter((c) => c !== id)
      : [...draft.campaign_ids, id]);

  const toggleTag = (tag: string) =>
    set("account_tags", draft.account_tags.includes(tag)
      ? draft.account_tags.filter((t) => t !== tag)
      : [...draft.account_tags, tag]);

  const toggleCategory = (cat: string) =>
    set("categories", draft.categories.includes(cat)
      ? draft.categories.filter((c) => c !== cat)
      : [...draft.categories, cat]);

  /** Pasar a envío automático es irreversible de cara al lead: confirmar siempre. */
  const handleModeChange = async (mode: ReplyMode) => {
    if (mode === "auto" && draft.reply_mode !== "auto") {
      const ok = await confirm({
        title: "Las respuestas se enviarán sin revisión. ¿Activar envío automático?",
        description:
          "El agente responderá a los leads por su cuenta, sin que tú apruebes cada mensaje. Puedes volver a borradores cuando quieras.",
        confirmText: "Activar envío automático",
      });
      if (!ok) return;
    }
    set("reply_mode", mode);
  };

  const handleSave = async () => {
    if (!user) return;
    const problem = validateAgentDraft(draft);
    if (problem) { toast.error(problem); return; }

    setSaving(true);
    const payload = {
      name: draft.name.trim(),
      primary_goal: draft.primary_goal,
      custom_goal: draft.primary_goal === "custom" ? draft.custom_goal.trim() : "",
      scope_type: draft.scope_type,
      // account_ids/account_tags/campaign_ids se guardan tal cual: `scope_type` es
      // quien manda, así que cambiar de alcance no borra la selección anterior.
      account_ids: draft.account_ids,
      account_tags: draft.account_tags,
      campaign_ids: draft.campaign_ids,
      category_mode: draft.category_mode,
      categories: draft.category_mode === "specific" ? draft.categories : [...REPLYABLE_CATEGORIES],
      reply_mode: draft.reply_mode,
      tone: draft.tone,
      length: draft.length,
      delay_minutes: draft.delay_minutes,
      max_replies_per_day: draft.max_replies_per_day,
      style_prompt: draft.style_prompt,
      business_context: draft.business_context,
      objection_handling: draft.objection_handling,
      resources: draft.resources.filter((r) => r.name.trim() || r.url.trim()),
      signature_name: draft.signature_name.trim(),
    };

    if (agent) {
      const { error } = await supabase.from("auto_reply_rules").update(payload).eq("id", agent.id);
      setSaving(false);
      if (error) { toast.error(error.message); return; }
      toast.success("Agente actualizado");
    } else {
      const { error } = await supabase
        .from("auto_reply_rules")
        .insert({ ...payload, user_id: user.id, is_active: draft.is_active });
      setSaving(false);
      if (error) { toast.error(error.message); return; }
      toast.success("Agente creado");
    }
    onSaved();
  };

  return (
    <div className="space-y-4">
      {/* Cabecera */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <Button variant="ghost" size="icon" className="mt-0.5 h-8 w-8 shrink-0" onClick={onClose} aria-label="Volver">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0">
            {editingName ? (
              <Input
                autoFocus
                value={draft.name}
                placeholder="Nombre del agente"
                onChange={(e) => set("name", e.target.value)}
                onBlur={() => draft.name.trim() && setEditingName(false)}
                onKeyDown={(e) => { if (e.key === "Enter" && draft.name.trim()) setEditingName(false); }}
                className="h-9 max-w-xs text-lg font-semibold"
              />
            ) : (
              <button
                type="button"
                onClick={() => setEditingName(true)}
                className="group flex items-center gap-2 text-left"
              >
                <h2 className="font-display truncate text-xl font-semibold tracking-[-0.03em]">
                  {draft.name || "Agente sin nombre"}
                </h2>
                <Pencil className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
              </button>
            )}
            <p className="mt-1 text-sm text-muted-foreground">
              Elige objetivo, alcance, tono y contexto para que las respuestas encajen
            </p>
          </div>
        </div>
        <Button onClick={handleSave} disabled={saving} className="gap-2">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Guardar
        </Button>
      </div>

      <div className="flex flex-col gap-5 md:flex-row">
        {/* Nav lateral (tiras horizontales en móvil) */}
        <nav className="-mx-1 flex shrink-0 gap-1.5 overflow-x-auto px-1 pb-1 md:mx-0 md:w-56 md:flex-col md:overflow-visible md:px-0 md:pb-0">
          {SECTIONS.map((s) => {
            const Icon = s.icon;
            const active = section === s.key;
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => setSection(s.key)}
                className={cn(
                  "flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm transition-colors md:w-full",
                  active
                    ? "bg-primary/10 font-medium text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {s.label}
              </button>
            );
          })}
        </nav>

        {/* Contenido */}
        <Card className="min-w-0 flex-1">
          <CardContent className="space-y-6 p-5 md:p-6">
            {section === "goal" && (
              <>
                <div>
                  <label className="mb-1.5 block text-sm font-medium">Objetivo principal</label>
                  <p className="mb-2 text-xs text-muted-foreground">
                    Hacia dónde empuja el agente cada conversación.
                  </p>
                  <Select
                    value={draft.primary_goal}
                    onValueChange={(v) => set("primary_goal", v as PrimaryGoal)}
                  >
                    <SelectTrigger className="max-w-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(Object.keys(GOAL_LABELS) as PrimaryGoal[]).map((g) => (
                        <SelectItem key={g} value={g}>{GOAL_LABELS[g]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {draft.primary_goal === "custom" && (
                    <Textarea
                      value={draft.custom_goal}
                      onChange={(e) => set("custom_goal", e.target.value.slice(0, MAX_CONTEXT_CHARS))}
                      placeholder="Describe qué debe conseguir el agente en cada conversación…"
                      className="mt-3 min-h-[90px] resize-y"
                    />
                  )}
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-medium">Alcance del agente</label>
                  <p className="mb-3 text-xs text-muted-foreground">
                    A qué respuestas se aplica este agente.
                  </p>
                  <div className="space-y-2">
                    {([
                      { value: "account", label: "Toda la cuenta", desc: "Se aplica a todas las respuestas que recibas" },
                      { value: "campaign", label: "Por campaña", desc: "Solo a las respuestas de las campañas elegidas" },
                      { value: "tags", label: "Por etiquetas de buzón", desc: "Solo a los buzones con estas etiquetas" },
                    ] as { value: ScopeType; label: string; desc: string }[]).map((o) => (
                      <SelectableCard
                        key={o.value}
                        selected={draft.scope_type === o.value}
                        onSelect={() => set("scope_type", o.value)}
                        title={o.label}
                        description={o.desc}
                      />
                    ))}
                  </div>

                  {draft.scope_type === "campaign" && (
                    <div className="mt-4 rounded-md border border-border/70 bg-muted/30 p-4">
                      <label className="mb-2 block text-sm font-medium">Campañas</label>
                      {draft.campaign_ids.length > 0 && (
                        <div className="mb-2 flex flex-wrap gap-1.5">
                          {draft.campaign_ids.map((id) => (
                            <Badge key={id} variant="secondary" className="gap-1 text-[10.5px] font-semibold">
                              <Megaphone className="h-2.5 w-2.5" />
                              {campaignById[id]?.name || "Campaña eliminada"}
                              <button type="button" onClick={() => toggleCampaign(id)} aria-label="Quitar campaña">
                                <X className="h-3 w-3" />
                              </button>
                            </Badge>
                          ))}
                        </div>
                      )}
                      <Popover open={campaignOpen} onOpenChange={setCampaignOpen}>
                        <PopoverTrigger asChild>
                          <Button variant="outline" size="sm" className="gap-2 text-xs">
                            <Plus className="h-3.5 w-3.5" /> Añadir campaña <ChevronDown className="h-3 w-3" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="z-50 w-80 border border-border bg-popover p-0 shadow-float" align="start">
                          <div className="border-b border-border p-2">
                            <Input
                              placeholder="Buscar campaña…"
                              value={campaignSearch}
                              onChange={(e) => setCampaignSearch(e.target.value)}
                              className="h-8 text-xs"
                            />
                          </div>
                          <div className="max-h-56 overflow-y-auto p-1">
                            {filteredCampaigns.length === 0 ? (
                              <p className="py-3 text-center text-xs text-muted-foreground">Sin campañas</p>
                            ) : (
                              filteredCampaigns.map((c) => (
                                <button
                                  key={c.id}
                                  type="button"
                                  onClick={() => toggleCampaign(c.id)}
                                  className={cn(
                                    "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs transition-colors",
                                    draft.campaign_ids.includes(c.id)
                                      ? "bg-primary/10 font-medium text-primary"
                                      : "text-foreground hover:bg-muted",
                                  )}
                                >
                                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                                  <Badge variant="outline" className="shrink-0 text-[10.5px] font-semibold">
                                    {STATUS_LABELS[c.status] || c.status}
                                  </Badge>
                                  {draft.campaign_ids.includes(c.id) && <Check className="h-3.5 w-3.5 shrink-0" />}
                                </button>
                              ))
                            )}
                          </div>
                        </PopoverContent>
                      </Popover>
                    </div>
                  )}

                  {draft.scope_type === "tags" && (
                    <div className="mt-4 rounded-md border border-border/70 bg-muted/30 p-4">
                      <label className="mb-2 block text-sm font-medium">Etiquetas de buzón</label>
                      {availableTags.length === 0 ? (
                        <p className="text-xs italic text-muted-foreground">No hay etiquetas en tus cuentas de email.</p>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {availableTags.map((tag) => (
                            <button
                              key={tag}
                              type="button"
                              onClick={() => toggleTag(tag)}
                              className={cn(
                                "inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-[13px] font-semibold leading-none shadow-rest transition-all",
                                draft.account_tags.includes(tag)
                                  ? "border-transparent bg-primary text-primary-foreground shadow-btn"
                                  : "border-border bg-card text-muted-foreground hover:bg-muted/60",
                              )}
                            >
                              <Tag className="h-3 w-3" />
                              {tag}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium">
                      <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                      Esperar X minutos antes de responder
                    </label>
                    <Input
                      type="number"
                      min={0}
                      max={1440}
                      value={draft.delay_minutes}
                      onChange={(e) => set("delay_minutes", Math.max(0, parseInt(e.target.value) || 0))}
                      className="w-32"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium">Máximo de respuestas al día</label>
                    <Input
                      type="number"
                      min={1}
                      max={1000}
                      value={draft.max_replies_per_day}
                      onChange={(e) => set("max_replies_per_day", Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-32"
                    />
                  </div>
                </div>
              </>
            )}

            {section === "categories" && (
              <>
                <div>
                  <label className="mb-1.5 block text-sm font-medium">Aplicación</label>
                  <p className="mb-3 text-xs text-muted-foreground">
                    Decide si el agente contesta a todo o solo a ciertas categorías.
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {([
                      { value: "all", label: "Todas las respuestas", desc: "El agente valora cualquier respuesta que llegue" },
                      { value: "specific", label: "Categorías concretas", desc: "Solo responde a las categorías que elijas" },
                    ] as { value: CategoryMode; label: string; desc: string }[]).map((o) => (
                      <SelectableCard
                        key={o.value}
                        selected={draft.category_mode === o.value}
                        onSelect={() => set("category_mode", o.value)}
                        title={o.label}
                        description={o.desc}
                      />
                    ))}
                  </div>
                </div>

                {draft.category_mode === "specific" && (
                  <div>
                    <label className="mb-2 block text-sm font-medium">Categorías</label>
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {draft.categories.length === 0 ? (
                        <span className="text-xs italic text-muted-foreground">Ninguna categoría seleccionada</span>
                      ) : (
                        draft.categories.map((c) => (
                          <Badge key={c} variant="secondary" className="gap-1 text-[10.5px] font-semibold">
                            {c}
                            <button type="button" onClick={() => toggleCategory(c)} aria-label={`Quitar ${c}`}>
                              <X className="h-3 w-3" />
                            </button>
                          </Badge>
                        ))
                      )}
                    </div>
                    <Popover open={categoryOpen} onOpenChange={setCategoryOpen}>
                      <PopoverTrigger asChild>
                        <Button variant="outline" size="sm" className="gap-2 text-xs">
                          <Plus className="h-3.5 w-3.5" /> Añadir categoría <ChevronDown className="h-3 w-3" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="z-50 w-60 border border-border bg-popover p-1 shadow-float" align="start">
                        {REPLYABLE_CATEGORIES.map((c) => (
                          <button
                            key={c}
                            type="button"
                            onClick={() => toggleCategory(c)}
                            className={cn(
                              "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs transition-colors",
                              draft.categories.includes(c)
                                ? "bg-primary/10 font-medium text-primary"
                                : "text-foreground hover:bg-muted",
                            )}
                          >
                            <span className="flex-1">{c}</span>
                            {draft.categories.includes(c) && <Check className="h-3.5 w-3.5" />}
                          </button>
                        ))}
                      </PopoverContent>
                    </Popover>
                  </div>
                )}

                <div className="flex gap-2 rounded-md border border-info/30 bg-info/10 p-3">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-info" />
                  <p className="text-xs leading-relaxed text-foreground/80">
                    {NEVER_REPLY_CATEGORIES.join(", ")} nunca reciben respuesta del agente, elijas lo que elijas aquí.
                  </p>
                </div>
              </>
            )}

            {section === "mode" && (
              <>
                <div className="grid gap-2 sm:grid-cols-2">
                  <SelectableCard
                    selected={draft.reply_mode === "auto"}
                    onSelect={() => { void handleModeChange("auto"); }}
                    icon={<Bot className="h-4 w-4" />}
                    title="Envío automático"
                    description="El agente responde solo, sin que revises nada"
                  />
                  <SelectableCard
                    selected={draft.reply_mode === "draft"}
                    onSelect={() => { void handleModeChange("draft"); }}
                    icon={<UserCheck className="h-4 w-4" />}
                    title="Borrador para revisar"
                    description="Tú apruebas cada respuesta antes de enviarla"
                  />
                </div>
                <div
                  className={cn(
                    "flex gap-2 rounded-md border p-3",
                    draft.reply_mode === "auto"
                      ? "border-warning/30 bg-warning/10"
                      : "border-info/30 bg-info/10",
                  )}
                >
                  <Info className={cn("mt-0.5 h-4 w-4 shrink-0", draft.reply_mode === "auto" ? "text-warning" : "text-info")} />
                  <p className="text-xs leading-relaxed text-foreground/80">
                    {draft.reply_mode === "auto"
                      ? "El agente responde al instante sin revisión; tú te mantienes al margen."
                      : "El agente redacta y tú apruebas cada respuesta desde el Unibox antes de enviarla."}
                  </p>
                </div>
              </>
            )}

            {section === "tone" && (
              <>
                <div>
                  <label className="mb-3 block text-sm font-medium">Tono</label>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {TONE_OPTIONS.map((o) => (
                      <SelectableCard
                        key={o.value}
                        selected={draft.tone === o.value}
                        onSelect={() => set("tone", o.value as Tone)}
                        title={o.label}
                        description={o.description}
                      />
                    ))}
                  </div>
                </div>
                <div>
                  <label className="mb-3 block text-sm font-medium">Longitud</label>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {LENGTH_OPTIONS.map((o) => (
                      <SelectableCard
                        key={o.value}
                        selected={draft.length === o.value}
                        onSelect={() => set("length", o.value as ReplyLength)}
                        title={o.label}
                        description={o.description}
                      />
                    ))}
                  </div>
                </div>
              </>
            )}

            {section === "context" && (
              <>
                <CounterTextarea
                  label="Estilo de comunicación personalizado"
                  hint="Cómo debe sonar el agente: expresiones que usas, lo que nunca dirías…"
                  value={draft.style_prompt}
                  onChange={(v) => set("style_prompt", v)}
                  placeholder="Ej: Tutea siempre, frases cortas, sin tecnicismos…"
                />
                <CounterTextarea
                  label="Contexto y lógica de negocio"
                  hint="Qué vendes, a quién, precios, plazos y reglas que el agente debe respetar."
                  value={draft.business_context}
                  onChange={(v) => set("business_context", v)}
                  placeholder="Ej: Somos una agencia de cold email; el plan base son 500 €/mes…"
                />
                <CounterTextarea
                  label="Referencia para objeciones"
                  hint="Cómo responder a las dudas que más se repiten."
                  value={draft.objection_handling}
                  onChange={(v) => set("objection_handling", v)}
                  placeholder='Ej: "Ya tenemos proveedor" → propón una comparativa sin compromiso…'
                />

                <div>
                  <label className="mb-1.5 block text-sm font-medium">Recursos para compartir</label>
                  <p className="mb-2 text-xs text-muted-foreground">
                    Enlaces que el agente puede incluir cuando encajen (calendario, caso de éxito, web…).
                  </p>
                  <div className="space-y-2">
                    {draft.resources.map((r, i) => (
                      <div key={i} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <Input
                          placeholder="Nombre"
                          value={r.name}
                          onChange={(e) => {
                            const next = [...draft.resources];
                            next[i] = { ...next[i], name: e.target.value };
                            set("resources", next);
                          }}
                          className="sm:max-w-[200px]"
                        />
                        <Input
                          placeholder="https://…"
                          value={r.url}
                          onChange={(e) => {
                            const next = [...draft.resources];
                            next[i] = { ...next[i], url: e.target.value };
                            set("resources", next);
                          }}
                          className="flex-1"
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9 shrink-0 text-destructive"
                          onClick={() => set("resources", draft.resources.filter((_, idx) => idx !== i))}
                          aria-label="Eliminar recurso"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2 gap-2 text-xs"
                    onClick={() => set("resources", [...draft.resources, { name: "", url: "" }])}
                  >
                    <Link2 className="h-3.5 w-3.5" /> Añadir recurso
                  </Button>
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-medium">Firma</label>
                  <Input
                    value={draft.signature_name}
                    onChange={(e) => set("signature_name", e.target.value)}
                    placeholder="Nombre que firma; vacío = el del buzón"
                    className="max-w-sm"
                  />
                </div>
              </>
            )}

            {section === "integrations" && (
              <div className="flex flex-col items-center justify-center rounded-md border border-dashed border-border py-14 text-center">
                <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
                  <Plug className="h-7 w-7 text-primary" />
                </div>
                <h3 className="font-display tracking-[-0.03em] text-base font-semibold">Próximamente</h3>
                <p className="mt-1 max-w-xs text-sm text-muted-foreground">
                  Calendario, CRM y otras integraciones para que el agente reserve y registre por ti.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default ReplyAgentEditor;
