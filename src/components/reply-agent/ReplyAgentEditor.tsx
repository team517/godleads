import { useMemo, useState, type ComponentType, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  ArrowLeft,
  Bot,
  Briefcase,
  Building2,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  Coffee,
  Crosshair,
  Eye,
  Filter,
  Info,
  Layers,
  Link2,
  ListFilter,
  Loader2,
  Megaphone,
  MessageSquareQuote,
  MessagesSquare,
  Monitor,
  PenLine,
  Plus,
  Plug,
  ShieldQuestion,
  Smile,
  Tag,
  Target,
  Trash2,
  Type,
  UserCheck,
  X,
  Zap,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirm } from "@/hooks/useConfirm";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
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

type IconType = ComponentType<{ className?: string }>;

const SECTIONS = [
  { key: "goal", label: "Objetivo y alcance", icon: Crosshair },
  { key: "categories", label: "Categorías de lead", icon: Tag },
  { key: "mode", label: "Modo de respuesta", icon: MessagesSquare },
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

const SCOPE_OPTIONS: { value: ScopeType; label: string; desc: string; icon: IconType }[] = [
  { value: "account", label: "Toda la cuenta", desc: "Se aplica a todas las respuestas que recibes", icon: Monitor },
  { value: "campaign", label: "Por campaña", desc: "Solo a las respuestas de las campañas elegidas", icon: Layers },
  { value: "tags", label: "Por etiquetas de buzón", desc: "Solo a los buzones con estas etiquetas", icon: Tag },
];

const TONE_ICONS: Record<Tone, IconType> = { professional: Briefcase, casual: Coffee, friendly: Smile, direct: Target };
const LENGTH_LINES: Record<ReplyLength, number> = { short: 1, medium: 2, long: 3 };

/* ── Piezas del diseño ─────────────────────────────────────────────────────────────── */

/** Bloque con su icono, título y explicación (las tarjetas de dentro del panel). */
function Panel({
  icon: Icon,
  title,
  desc,
  art,
  children,
}: {
  icon: IconType;
  title: string;
  desc?: string;
  art?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="relative overflow-hidden rounded-2xl border border-[#ebe8f8] bg-gradient-to-br from-white via-white to-[#f8f6ff] p-4 shadow-[0_1px_2px_rgba(16,24,64,.04)] dark:border-border dark:from-card dark:via-card dark:to-card sm:p-5">
      {art && (
        <div className="pointer-events-none absolute -bottom-2 right-0 hidden h-[120%] w-[230px] lg:block" aria-hidden="true">
          {art}
        </div>
      )}
      <div className="relative flex items-start gap-3.5">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#f2effe] text-primary ring-1 ring-[#e6e0fd] dark:bg-primary/15 dark:ring-primary/25">
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 pt-0.5">
          <h3 className="text-[16px] font-semibold leading-tight tracking-[-0.01em] text-[#0b1040] dark:text-foreground">{title}</h3>
          {desc && <p className="mt-1 text-[13px] leading-snug text-[#6470a8] dark:text-muted-foreground">{desc}</p>}
        </div>
      </div>
      {children && <div className="relative mt-4 sm:pl-[58px]">{children}</div>}
    </section>
  );
}

/** Opción en forma de tarjeta (icono arriba, círculo de selección a la derecha). */
function OptionCard({
  selected,
  onSelect,
  icon,
  title,
  description,
}: {
  selected: boolean;
  onSelect: () => void;
  icon?: ReactNode;
  title: string;
  description?: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "group relative flex h-full w-full flex-col items-start rounded-2xl border p-4 text-left transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
        selected
          ? "border-primary bg-gradient-to-br from-[#f5f2ff] to-[#ece7ff] shadow-[0_0_0_3px_rgba(110,88,241,.13),0_10px_24px_-12px_rgba(91,69,232,.45)] dark:from-primary/20 dark:to-primary/10"
          : "border-[#e6e8f2] bg-white hover:-translate-y-0.5 hover:border-primary/45 hover:shadow-[0_10px_22px_-14px_rgba(16,24,64,.35)] dark:border-border dark:bg-card",
      )}
    >
      <span
        className={cn(
          "absolute right-3.5 top-3.5 flex h-[22px] w-[22px] items-center justify-center rounded-full border-2 transition-colors",
          selected ? "border-primary bg-primary text-white" : "border-[#cfd3e6] bg-white dark:border-border dark:bg-card",
        )}
        aria-hidden="true"
      >
        {selected && <Check className="h-3 w-3" strokeWidth={3} />}
      </span>
      {icon && (
        <span className={cn("mb-3 flex h-7 items-center transition-colors", selected ? "text-primary" : "text-[#5b6190] group-hover:text-primary dark:text-muted-foreground")}>
          {icon}
        </span>
      )}
      <span className="block pr-7 text-[15px] font-semibold leading-tight text-[#0b1040] dark:text-foreground">{title}</span>
      {description && <span className="mt-1.5 block text-[13px] leading-snug text-[#6470a8] dark:text-muted-foreground">{description}</span>}
    </button>
  );
}

/** Campo numérico con flechas y sufijo opcional ("min"), como en la referencia. */
function NumberField({
  value,
  onChange,
  min,
  max,
  suffix,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  suffix?: string;
  label: string;
}) {
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  return (
    <div className="flex h-11 w-full max-w-[240px] overflow-hidden rounded-xl border border-[#e3e6f2] bg-white shadow-[0_1px_2px_rgba(16,24,64,.04)] focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 dark:border-border dark:bg-background">
      <input
        type="number"
        inputMode="numeric"
        aria-label={label}
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(clamp(parseInt(e.target.value) || min))}
        className="min-w-0 flex-1 bg-transparent px-3.5 text-[15px] font-medium text-[#0b1040] outline-none [appearance:textfield] dark:text-foreground [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <div className="flex w-8 flex-col items-center justify-center">
        <button type="button" aria-label={`Subir ${label.toLowerCase()}`} onClick={() => onChange(clamp(value + 1))} className="flex h-4 w-6 items-center justify-center rounded text-[#6470a8] hover:bg-[#f2effe] hover:text-primary">
          <ChevronUp className="h-3.5 w-3.5" />
        </button>
        <button type="button" aria-label={`Bajar ${label.toLowerCase()}`} onClick={() => onChange(clamp(value - 1))} className="flex h-4 w-6 items-center justify-center rounded text-[#6470a8] hover:bg-[#f2effe] hover:text-primary">
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      </div>
      {suffix && (
        <span className="flex items-center border-l border-[#e3e6f2] bg-[#f4f1ff] px-4 text-[14px] font-semibold text-primary dark:border-border dark:bg-primary/15">
          {suffix}
        </span>
      )}
    </div>
  );
}

/** Icono de "renglones" para la longitud de la respuesta. */
function Lines({ n }: { n: number }) {
  return (
    <span className="flex w-6 flex-col gap-[3px]" aria-hidden="true">
      {Array.from({ length: n }).map((_, i) => (
        <span key={i} className={cn("h-[3px] rounded-full bg-current", i === n - 1 && n > 1 ? "w-3/5" : "w-full")} />
      ))}
    </span>
  );
}

/** Diana con flecha (ilustración del objetivo). */
function TargetArt() {
  return (
    <svg viewBox="0 0 230 150" className="h-full w-full" fill="none">
      <defs>
        <linearGradient id="ra-face" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#B9A9FF" />
          <stop offset="1" stopColor="#6E58F1" />
        </linearGradient>
        <linearGradient id="ra-side" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6E58F1" />
          <stop offset="1" stopColor="#4330C9" />
        </linearGradient>
        <linearGradient id="ra-wave" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#6E58F1" stopOpacity="0" />
          <stop offset="1" stopColor="#6E58F1" stopOpacity=".22" />
        </linearGradient>
      </defs>
      <path d="M0 150 C 60 120, 120 140, 230 70 L230 150 Z" fill="url(#ra-wave)" />
      <g transform="translate(118 18) rotate(-8)">
        <rect x="6" y="10" width="96" height="96" rx="24" fill="url(#ra-side)" />
        <rect x="0" y="0" width="96" height="96" rx="24" fill="url(#ra-face)" />
        <circle cx="48" cy="48" r="32" fill="#fff" fillOpacity=".95" />
        <circle cx="48" cy="48" r="23" fill="#8B78F7" />
        <circle cx="48" cy="48" r="15" fill="#fff" />
        <circle cx="48" cy="48" r="7" fill="#5B45E8" />
        <path d="M50 46 L92 4" stroke="#3B2BB8" strokeWidth="4" strokeLinecap="round" />
        <path d="M86 2 l10 -2 l-2 10 z M92 8 l10 -2 l-2 10 z" fill="#B9A9FF" />
      </g>
      <g stroke="#8B78F7" strokeWidth="3.5" strokeLinecap="round">
        <path d="M86 30 l12 8" />
        <path d="M80 50 h13" />
        <path d="M94 14 l7 10" />
      </g>
    </svg>
  );
}

/** Ola violeta suave de la cabecera. */
function HeaderWave() {
  return (
    <svg viewBox="0 0 520 170" className="h-full w-full" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="ra-hw1" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#6E58F1" stopOpacity="0" />
          <stop offset=".55" stopColor="#7B66F5" stopOpacity=".28" />
          <stop offset="1" stopColor="#B9A9FF" stopOpacity=".05" />
        </linearGradient>
        <linearGradient id="ra-hw2" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#6E58F1" stopOpacity="0" />
          <stop offset=".6" stopColor="#5B45E8" stopOpacity=".18" />
          <stop offset="1" stopColor="#5B45E8" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d="M0 160 C 120 150, 170 110, 230 70 S 330 -10, 400 20 S 470 60, 520 10 L520 0 L0 0 Z" fill="url(#ra-hw2)" opacity=".5" />
      <path d="M40 170 C 150 160, 200 120, 260 80 S 360 10, 420 40 S 490 70, 520 40" stroke="url(#ra-hw1)" strokeWidth="26" strokeLinecap="round" />
      <path d="M60 170 C 170 165, 220 130, 280 92 S 370 30, 430 58" stroke="url(#ra-hw2)" strokeWidth="10" strokeLinecap="round" />
    </svg>
  );
}

function CounterTextarea({
  value,
  onChange,
  placeholder,
  rows = 5,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <div>
      <Textarea
        value={value}
        placeholder={placeholder}
        rows={rows}
        maxLength={MAX_CONTEXT_CHARS}
        onChange={(e) => onChange(e.target.value.slice(0, MAX_CONTEXT_CHARS))}
        className="resize-y rounded-xl border-[#e3e6f2] bg-white text-[14px] dark:border-border dark:bg-background"
      />
      <p className="mt-1 text-right text-[11px] text-muted-foreground">
        {value.length.toLocaleString("es-ES")} / {MAX_CONTEXT_CHARS.toLocaleString("es-ES")}
      </p>
    </div>
  );
}

function InfoNote({ tone = "info", children }: { tone?: "info" | "warning"; children: ReactNode }) {
  return (
    <div className={cn("flex gap-2.5 rounded-xl border p-3", tone === "warning" ? "border-warning/30 bg-warning/10" : "border-[#e2ddfd] bg-[#f7f5ff] dark:border-primary/25 dark:bg-primary/10")}>
      <Info className={cn("mt-0.5 h-4 w-4 shrink-0", tone === "warning" ? "text-warning" : "text-primary")} />
      <p className="text-[12.5px] leading-relaxed text-foreground/80">{children}</p>
    </div>
  );
}

/* ── Editor ────────────────────────────────────────────────────────────────────────── */

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
  const [saving, setSaving] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
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

  /* Resumen para la vista previa */
  const scopeText =
    draft.scope_type === "campaign"
      ? draft.campaign_ids.length
        ? draft.campaign_ids.map((id) => campaignById[id]?.name || "Campaña eliminada").join(", ")
        : "Por campaña (sin campañas elegidas)"
      : draft.scope_type === "tags"
        ? draft.account_tags.length ? `Etiquetas: ${draft.account_tags.join(", ")}` : "Por etiquetas (sin etiquetas elegidas)"
        : "Toda la cuenta";
  const previewRows: { icon: IconType; label: string; value: string }[] = [
    { icon: Crosshair, label: "Objetivo", value: draft.primary_goal === "custom" ? draft.custom_goal.trim() || "Personalizado (sin describir)" : GOAL_LABELS[draft.primary_goal] },
    { icon: Layers, label: "Alcance", value: scopeText },
    { icon: Tag, label: "Responde a", value: draft.category_mode === "specific" ? (draft.categories.join(", ") || "Ninguna categoría") : `Todas (${REPLYABLE_CATEGORIES.join(", ")})` },
    { icon: MessagesSquare, label: "Modo", value: draft.reply_mode === "auto" ? "Envío automático, sin revisión" : "Borrador para que lo revises en el Unibox" },
    { icon: Type, label: "Tono y longitud", value: `${TONE_OPTIONS.find((t) => t.value === draft.tone)?.label ?? draft.tone} · ${LENGTH_OPTIONS.find((l) => l.value === draft.length)?.label ?? draft.length} (${LENGTH_OPTIONS.find((l) => l.value === draft.length)?.description ?? ""})` },
    { icon: Clock, label: "Ritmo", value: `Espera ${draft.delay_minutes} min · máximo ${draft.max_replies_per_day} respuestas al día` },
    { icon: PenLine, label: "Firma", value: draft.signature_name.trim() || "La del buzón que responde" },
  ];

  return (
    <div className="relative space-y-6">
      {/* Cabecera */}
      <div className="relative">
        <div className="pointer-events-none absolute -top-8 right-[18%] hidden h-[170px] w-[520px] md:block" aria-hidden="true">
          <HeaderWave />
        </div>
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3.5">
            <button
              type="button"
              onClick={onClose}
              aria-label="Volver"
              className="mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] border border-[#e3e6f2] bg-white text-[#3b3f8f] shadow-[0_1px_2px_rgba(16,24,64,.05)] transition-colors hover:border-primary/50 hover:text-primary dark:border-border dark:bg-card dark:text-foreground"
            >
              <ArrowLeft className="h-[18px] w-[18px]" />
            </button>
            <div className="min-w-0">
              <h1 className="font-display text-[clamp(26px,2.6vw,34px)] font-semibold leading-tight tracking-[-0.03em] text-[#0b1040] dark:text-foreground">
                {agent ? "Editar agente" : "Nuevo agente"}
              </h1>
              <p className="mt-1 text-[15px] text-[#6470a8] dark:text-muted-foreground">
                Configura el comportamiento, alcance y estilo de tu agente de IA.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => setPreviewOpen(true)}
              className="inline-flex h-11 items-center gap-2 rounded-[14px] border border-[#e3e6f2] bg-white px-4 text-[14.5px] font-medium text-[#3b3f8f] shadow-[0_1px_2px_rgba(16,24,64,.05)] transition-colors hover:border-primary/50 dark:border-border dark:bg-card dark:text-foreground"
            >
              <Eye className="h-[18px] w-[18px] text-primary" /> Vista previa
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="inline-flex h-11 items-center gap-2 rounded-[14px] bg-gradient-to-r from-[#7B66F5] to-[#5B45E8] px-5 text-[14.5px] font-semibold text-white shadow-[0_10px_22px_-8px_rgba(91,69,232,.6)] transition-all hover:brightness-110 disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-[18px] w-[18px] animate-spin" /> : <Check className="h-[18px] w-[18px]" strokeWidth={2.5} />}
              {agent ? "Guardar cambios" : "Crear agente"}
            </button>
          </div>
        </div>
      </div>

      {/* Nombre */}
      <div className="flex items-center gap-4">
        <span className="flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#f4f1ff] to-[#e4ddff] text-primary shadow-[inset_0_0_0_1px_rgba(110,88,241,.18),0_10px_24px_-14px_rgba(91,69,232,.55)] dark:from-primary/25 dark:to-primary/10">
          <Bot className="h-8 w-8" />
        </span>
        <div className="min-w-0 flex-1">
          <label htmlFor="ra-name" className="mb-1.5 block text-[13px] font-medium text-[#6470a8] dark:text-muted-foreground">Nombre del agente</label>
          <Input
            id="ra-name"
            autoFocus={!agent}
            value={draft.name}
            placeholder="Ej: Agente de soporte"
            onChange={(e) => set("name", e.target.value)}
            className="h-12 max-w-[600px] rounded-xl border-[#e3e6f2] bg-white text-[16px] font-semibold text-[#0b1040] shadow-[0_1px_2px_rgba(16,24,64,.04)] dark:border-border dark:bg-background dark:text-foreground"
          />
          <p className="mt-1.5 text-[13px] text-[#6470a8] dark:text-muted-foreground">
            Elige objetivo, alcance, tono y contexto para que las respuestas encajen.
          </p>
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-[236px_minmax(0,1fr)]">
        {/* Menú de secciones (fila deslizable en móvil) */}
        <nav aria-label="Secciones del agente" className="self-start md:sticky md:top-4">
          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 md:mx-0 md:flex-col md:overflow-visible md:rounded-2xl md:border md:border-[#ebe8f8] md:bg-white md:p-2 md:pb-2 md:shadow-[0_1px_2px_rgba(16,24,64,.04)] md:dark:border-border md:dark:bg-card">
            {SECTIONS.map((s) => {
              const Icon = s.icon;
              const active = section === s.key;
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setSection(s.key)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex h-11 shrink-0 items-center gap-3 whitespace-nowrap rounded-xl px-3.5 text-[14.5px] transition-all md:w-full",
                    active
                      ? "bg-gradient-to-r from-[#7B66F5] to-[#5B45E8] font-semibold text-white shadow-[0_8px_18px_-8px_rgba(91,69,232,.65)]"
                      : "border border-[#ebe8f8] bg-white text-[#3b3f6b] hover:bg-[#f5f3ff] hover:text-primary md:border-transparent md:bg-transparent dark:border-border dark:bg-card dark:text-muted-foreground md:dark:bg-transparent",
                  )}
                >
                  <Icon className="h-[18px] w-[18px] shrink-0" />
                  {s.label}
                </button>
              );
            })}
          </div>
        </nav>

        {/* Contenido */}
        <div className="min-w-0 space-y-4 rounded-3xl border border-[#ebe8f8] bg-[#fbfaff]/80 p-3 dark:border-border dark:bg-card/40 sm:p-4">
          {section === "goal" && (
            <>
              <Panel icon={Crosshair} title="Objetivo principal" desc="Hacia dónde empuja el agente cada conversación." art={<TargetArt />}>
                <div className="lg:pr-[200px]">
                  <Select value={draft.primary_goal} onValueChange={(v) => set("primary_goal", v as PrimaryGoal)}>
                    <SelectTrigger className="h-11 max-w-[560px] rounded-xl border-[#e3e6f2] bg-white text-[14.5px] dark:border-border dark:bg-background">
                      <SelectValue />
                    </SelectTrigger>
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
                      className="mt-3 min-h-[90px] max-w-[560px] resize-y rounded-xl border-[#e3e6f2] bg-white dark:border-border dark:bg-background"
                    />
                  )}
                </div>
              </Panel>

              <Panel icon={Layers} title="Alcance del agente" desc="A qué respuestas se aplica este agente.">
                <div role="radiogroup" aria-label="Alcance del agente" className="grid gap-3 sm:grid-cols-3">
                  {SCOPE_OPTIONS.map((o) => {
                    const Icon = o.icon;
                    return (
                      <OptionCard
                        key={o.value}
                        selected={draft.scope_type === o.value}
                        onSelect={() => set("scope_type", o.value)}
                        icon={<Icon className="h-6 w-6" />}
                        title={o.label}
                        description={o.desc}
                      />
                    );
                  })}
                </div>

                {draft.scope_type === "campaign" && (
                  <div className="mt-4 rounded-xl border border-[#ebe8f8] bg-white p-4 dark:border-border dark:bg-background">
                    <p className="mb-2 text-[13.5px] font-semibold text-[#0b1040] dark:text-foreground">Campañas</p>
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
                        <Button variant="outline" size="sm" className="gap-2 rounded-lg text-xs">
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
                  <div className="mt-4 rounded-xl border border-[#ebe8f8] bg-white p-4 dark:border-border dark:bg-background">
                    <p className="mb-2 text-[13.5px] font-semibold text-[#0b1040] dark:text-foreground">Etiquetas de buzón</p>
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
                              "inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-[13px] font-semibold leading-none transition-all",
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

                <div className="mt-5 grid gap-5 border-t border-[#ebe8f8] pt-5 dark:border-border sm:grid-cols-2 sm:gap-0 sm:divide-x sm:divide-[#ebe8f8] sm:dark:divide-border">
                  <div className="sm:pr-6">
                    <p className="mb-2 flex items-center gap-2 text-[14.5px] font-semibold text-[#0b1040] dark:text-foreground">
                      <Clock className="h-[18px] w-[18px] text-[#6470a8]" /> Esperar X minutos antes de responder
                    </p>
                    <NumberField label="Minutos de espera" value={draft.delay_minutes} min={0} max={1440} suffix="min" onChange={(v) => set("delay_minutes", v)} />
                  </div>
                  <div className="sm:pl-6">
                    <p className="mb-2 flex items-center gap-2 text-[14.5px] font-semibold text-[#0b1040] dark:text-foreground">
                      <Zap className="h-[18px] w-[18px] text-primary" /> Máximo de respuestas al día
                    </p>
                    <NumberField label="Respuestas al día" value={draft.max_replies_per_day} min={1} max={1000} onChange={(v) => set("max_replies_per_day", v)} />
                  </div>
                </div>
              </Panel>
            </>
          )}

          {section === "categories" && (
            <>
              <Panel icon={Tag} title="Categorías de lead" desc="Decide si el agente contesta a todo o solo a ciertas categorías.">
                <div role="radiogroup" aria-label="Categorías de lead" className="grid gap-3 sm:grid-cols-2">
                  {([
                    { value: "all", label: "Todas las respuestas", desc: "El agente valora cualquier respuesta que llegue", icon: MessagesSquare },
                    { value: "specific", label: "Categorías concretas", desc: "Solo responde a las categorías que elijas", icon: Filter },
                  ] as { value: CategoryMode; label: string; desc: string; icon: IconType }[]).map((o) => {
                    const Icon = o.icon;
                    return (
                      <OptionCard
                        key={o.value}
                        selected={draft.category_mode === o.value}
                        onSelect={() => set("category_mode", o.value)}
                        icon={<Icon className="h-6 w-6" />}
                        title={o.label}
                        description={o.desc}
                      />
                    );
                  })}
                </div>

                {draft.category_mode === "specific" && (
                  <div className="mt-4 rounded-xl border border-[#ebe8f8] bg-white p-4 dark:border-border dark:bg-background">
                    <p className="mb-2 text-[13.5px] font-semibold text-[#0b1040] dark:text-foreground">Categorías</p>
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
                        <Button variant="outline" size="sm" className="gap-2 rounded-lg text-xs">
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

                <div className="mt-4">
                  <InfoNote>{NEVER_REPLY_CATEGORIES.join(", ")} nunca reciben respuesta del agente, elijas lo que elijas aquí.</InfoNote>
                </div>
              </Panel>
            </>
          )}

          {section === "mode" && (
            <Panel icon={MessagesSquare} title="Modo de respuesta" desc="Cómo salen las respuestas que redacta el agente.">
              <div role="radiogroup" aria-label="Modo de respuesta" className="grid gap-3 sm:grid-cols-2">
                <OptionCard
                  selected={draft.reply_mode === "auto"}
                  onSelect={() => { void handleModeChange("auto"); }}
                  icon={<Zap className="h-6 w-6" />}
                  title="Envío automático"
                  description="El agente responde solo, sin que revises nada"
                />
                <OptionCard
                  selected={draft.reply_mode === "draft"}
                  onSelect={() => { void handleModeChange("draft"); }}
                  icon={<UserCheck className="h-6 w-6" />}
                  title="Borrador para revisar"
                  description="Tú apruebas cada respuesta antes de enviarla"
                />
              </div>
              <div className="mt-4">
                <InfoNote tone={draft.reply_mode === "auto" ? "warning" : "info"}>
                  {draft.reply_mode === "auto"
                    ? "El agente responde al instante sin revisión; tú te mantienes al margen."
                    : "El agente redacta y tú apruebas cada respuesta desde el Unibox antes de enviarla."}
                </InfoNote>
              </div>
            </Panel>
          )}

          {section === "tone" && (
            <>
              <Panel icon={Type} title="Tono" desc="Cómo suena el agente al hablar con tus leads.">
                <div role="radiogroup" aria-label="Tono" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {TONE_OPTIONS.map((o) => {
                    const Icon = TONE_ICONS[o.value];
                    return (
                      <OptionCard
                        key={o.value}
                        selected={draft.tone === o.value}
                        onSelect={() => set("tone", o.value as Tone)}
                        icon={<Icon className="h-6 w-6" />}
                        title={o.label}
                        description={o.description}
                      />
                    );
                  })}
                </div>
              </Panel>
              <Panel icon={ListFilter} title="Longitud" desc="Cuánto escribe en cada respuesta.">
                <div role="radiogroup" aria-label="Longitud" className="grid gap-3 sm:grid-cols-3">
                  {LENGTH_OPTIONS.map((o) => (
                    <OptionCard
                      key={o.value}
                      selected={draft.length === o.value}
                      onSelect={() => set("length", o.value as ReplyLength)}
                      icon={<Lines n={LENGTH_LINES[o.value]} />}
                      title={o.label}
                      description={o.description}
                    />
                  ))}
                </div>
              </Panel>
            </>
          )}

          {section === "context" && (
            <>
              <Panel icon={MessageSquareQuote} title="Estilo de comunicación" desc="Cómo debe sonar el agente: expresiones que usas, lo que nunca dirías…">
                <CounterTextarea value={draft.style_prompt} onChange={(v) => set("style_prompt", v)} placeholder="Ej: Tutea siempre, frases cortas, sin tecnicismos…" rows={4} />
              </Panel>
              <Panel icon={Building2} title="Contexto y lógica de negocio" desc="Qué vendes, a quién, precios, plazos y reglas que el agente debe respetar.">
                <CounterTextarea value={draft.business_context} onChange={(v) => set("business_context", v)} placeholder="Ej: Somos una agencia de cold email; el plan base son 500 €/mes…" />
              </Panel>
              <Panel icon={ShieldQuestion} title="Referencia para objeciones" desc="Cómo responder a las dudas que más se repiten.">
                <CounterTextarea value={draft.objection_handling} onChange={(v) => set("objection_handling", v)} placeholder='Ej: "Ya tenemos proveedor" → propón una comparativa sin compromiso…' rows={4} />
              </Panel>
              <Panel icon={Link2} title="Recursos para compartir" desc="Enlaces que el agente puede incluir cuando encajen (calendario, caso de éxito, web…).">
                <div className="space-y-2">
                  {draft.resources.map((r, i) => (
                    <div key={i} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <Input
                        placeholder="Nombre"
                        aria-label="Nombre del recurso"
                        value={r.name}
                        onChange={(e) => {
                          const next = [...draft.resources];
                          next[i] = { ...next[i], name: e.target.value };
                          set("resources", next);
                        }}
                        className="h-10 rounded-xl border-[#e3e6f2] bg-white dark:border-border dark:bg-background sm:max-w-[200px]"
                      />
                      <Input
                        placeholder="https://…"
                        aria-label="Enlace del recurso"
                        value={r.url}
                        onChange={(e) => {
                          const next = [...draft.resources];
                          next[i] = { ...next[i], url: e.target.value };
                          set("resources", next);
                        }}
                        className="h-10 flex-1 rounded-xl border-[#e3e6f2] bg-white dark:border-border dark:bg-background"
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-10 w-10 shrink-0 text-destructive"
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
                  className="mt-2 gap-2 rounded-lg text-xs"
                  onClick={() => set("resources", [...draft.resources, { name: "", url: "" }])}
                >
                  <Plus className="h-3.5 w-3.5" /> Añadir recurso
                </Button>
              </Panel>
              <Panel icon={PenLine} title="Firma" desc="Nombre con el que firma; si lo dejas vacío, usa el del buzón.">
                <Input
                  value={draft.signature_name}
                  onChange={(e) => set("signature_name", e.target.value)}
                  placeholder="Ej: Laura, del equipo comercial"
                  aria-label="Firma"
                  className="h-11 max-w-[420px] rounded-xl border-[#e3e6f2] bg-white dark:border-border dark:bg-background"
                />
              </Panel>
            </>
          )}

          {section === "integrations" && (
            <Panel icon={Plug} title="Integraciones" desc="Conecta el agente con tus herramientas.">
              <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[#d9d4f7] bg-white py-12 text-center dark:border-border dark:bg-background">
                <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#f2effe] text-primary dark:bg-primary/15">
                  <Plug className="h-7 w-7" />
                </div>
                <h3 className="font-display text-base font-semibold tracking-[-0.03em]">Próximamente</h3>
                <p className="mt-1 max-w-xs text-sm text-muted-foreground">
                  Calendario, CRM y otras integraciones para que el agente reserve y registre por ti.
                </p>
              </div>
            </Panel>
          )}
        </div>
      </div>

      {/* Vista previa: cómo trabajará el agente con lo elegido */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-h-[92dvh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <div className="mb-1 flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-[#f4f1ff] to-[#e4ddff] text-primary dark:from-primary/25 dark:to-primary/10">
                <Bot className="h-5 w-5" />
              </span>
              <div className="min-w-0 text-left">
                <DialogTitle className="truncate font-display tracking-[-0.03em]">{draft.name.trim() || "Agente sin nombre"}</DialogTitle>
                <DialogDescription>Así trabajará con lo que has elegido.</DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <ul className="divide-y divide-border rounded-2xl border border-border">
            {previewRows.map(({ icon: Icon, label, value }) => (
              <li key={label} className="flex gap-3 px-4 py-3">
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <div className="min-w-0">
                  <p className="text-[12px] font-medium uppercase tracking-[0.04em] text-muted-foreground">{label}</p>
                  <p className="break-words text-[14px] text-foreground">{value}</p>
                </div>
              </li>
            ))}
          </ul>
          <p className="text-[12.5px] text-muted-foreground">
            {[
              draft.style_prompt.trim() && "estilo propio",
              draft.business_context.trim() && "contexto del negocio",
              draft.objection_handling.trim() && "guía de objeciones",
              draft.resources.some((r) => r.url.trim()) && `${draft.resources.filter((r) => r.url.trim()).length} recurso(s)`,
            ].filter(Boolean).join(" · ") || "Sin contexto todavía: añádelo en «Contexto y guía» para que responda mejor."}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setPreviewOpen(false)}>Seguir editando</Button>
            <Button onClick={() => { setPreviewOpen(false); void handleSave(); }} disabled={saving} className="gap-2">
              <Check className="h-4 w-4" /> {agent ? "Guardar cambios" : "Crear agente"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default ReplyAgentEditor;
