/**
 * Tipos y constantes compartidos del "Agente de respuestas" (Reply Agent).
 * Una fila de `auto_reply_rules` = un agente.
 */

export type PrimaryGoal = "book_meeting" | "share_info" | "qualify" | "custom";
export type ScopeType = "account" | "campaign" | "tags";
export type CategoryMode = "all" | "specific";
export type ReplyMode = "draft" | "auto";
export type Tone = "professional" | "casual" | "friendly" | "direct";
export type ReplyLength = "short" | "medium" | "long";

export interface AgentResource {
  name: string;
  url: string;
  /** Índice explícito: sin él, TS no acepta AgentResource[] como `Json` al guardar. */
  [key: string]: string;
}

export interface ReplyAgent {
  id: string;
  user_id: string;
  name: string;
  prompt: string;
  company_info: string;
  account_tags: string[];
  account_ids: string[];
  is_active: boolean;
  delay_minutes: number;
  created_at: string;
  updated_at: string;
  // Columnas nuevas (todas opcionales en cliente: filas antiguas pueden traer null)
  primary_goal: PrimaryGoal | null;
  custom_goal: string | null;
  scope_type: ScopeType | null;
  campaign_ids: string[] | null;
  category_mode: CategoryMode | null;
  categories: string[] | null;
  reply_mode: ReplyMode | null;
  tone: Tone | null;
  length: ReplyLength | null;
  style_prompt: string | null;
  business_context: string | null;
  objection_handling: string | null;
  resources: AgentResource[] | null;
  max_replies_per_day: number | null;
  signature_name: string | null;
}

export interface ReplyAgentDraft {
  name: string;
  primary_goal: PrimaryGoal;
  custom_goal: string;
  scope_type: ScopeType;
  account_ids: string[];
  account_tags: string[];
  campaign_ids: string[];
  category_mode: CategoryMode;
  categories: string[];
  reply_mode: ReplyMode;
  tone: Tone;
  length: ReplyLength;
  delay_minutes: number;
  max_replies_per_day: number;
  style_prompt: string;
  business_context: string;
  objection_handling: string;
  resources: AgentResource[];
  signature_name: string;
  is_active: boolean;
}

export const MAX_CONTEXT_CHARS = 10000;

/** Categorías que SÍ pueden recibir respuesta del agente. */
export const REPLYABLE_CATEGORIES = ["Interesado", "Pregunta", "Derivado"] as const;

/** Categorías que NUNCA reciben respuesta (informativo en la UI). */
export const NEVER_REPLY_CATEGORIES = ["Fuera/Auto", "No interesado", "No contactar"] as const;

export const GOAL_LABELS: Record<PrimaryGoal, string> = {
  book_meeting: "Conseguir reunión",
  share_info: "Compartir información",
  qualify: "Cualificar al lead",
  custom: "Personalizado",
};

export const TONE_OPTIONS: { value: Tone; label: string; description: string }[] = [
  { value: "professional", label: "Profesional", description: "Claro, formal y respetuoso" },
  { value: "casual", label: "Informal", description: "Relajado y sencillo" },
  { value: "friendly", label: "Cercano", description: "Cálido y personal" },
  { value: "direct", label: "Directo", description: "Claro y orientado a la acción" },
];

export const LENGTH_OPTIONS: { value: ReplyLength; label: string; description: string }[] = [
  { value: "short", label: "Corta", description: "30-50 palabras" },
  { value: "medium", label: "Media", description: "80-120 palabras" },
  { value: "long", label: "Larga", description: "150-200 palabras" },
];

export const LOG_STATUS_LABELS: Record<string, string> = {
  draft: "Borrador",
  sent: "Enviada",
  discarded: "Descartada",
  failed: "Fallida",
  skipped: "Omitida",
};

export function emptyAgentDraft(): ReplyAgentDraft {
  return {
    name: "",
    primary_goal: "book_meeting",
    custom_goal: "",
    scope_type: "account",
    account_ids: [],
    account_tags: [],
    campaign_ids: [],
    category_mode: "specific",
    categories: ["Interesado", "Pregunta"],
    reply_mode: "draft",
    tone: "professional",
    length: "medium",
    delay_minutes: 5,
    max_replies_per_day: 50,
    style_prompt: "",
    business_context: "",
    objection_handling: "",
    resources: [],
    signature_name: "",
    is_active: false,
  };
}

/** Normaliza el jsonb `resources` (puede venir como null, objeto suelto o array). */
export function parseResources(raw: unknown): AgentResource[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object" && !Array.isArray(r))
    .map((r) => ({ name: String(r.name ?? ""), url: String(r.url ?? "") }));
}

export function agentToDraft(agent: ReplyAgent): ReplyAgentDraft {
  const base = emptyAgentDraft();
  return {
    name: agent.name || "",
    primary_goal: agent.primary_goal || base.primary_goal,
    custom_goal: agent.custom_goal || "",
    scope_type: agent.scope_type || base.scope_type,
    account_ids: agent.account_ids || [],
    account_tags: agent.account_tags || [],
    campaign_ids: agent.campaign_ids || [],
    category_mode: agent.category_mode || base.category_mode,
    categories: agent.categories || base.categories,
    reply_mode: agent.reply_mode || base.reply_mode,
    tone: agent.tone || base.tone,
    length: agent.length || base.length,
    delay_minutes: typeof agent.delay_minutes === "number" ? agent.delay_minutes : base.delay_minutes,
    max_replies_per_day:
      typeof agent.max_replies_per_day === "number" ? agent.max_replies_per_day : base.max_replies_per_day,
    style_prompt: agent.style_prompt || "",
    business_context: agent.business_context || "",
    objection_handling: agent.objection_handling || "",
    resources: parseResources(agent.resources),
    signature_name: agent.signature_name || "",
    is_active: !!agent.is_active,
  };
}

/** Valida el formulario. Devuelve el mensaje de error o null si todo está bien. */
export function validateAgentDraft(d: ReplyAgentDraft): string | null {
  if (!d.name.trim()) return "Pon un nombre al agente";
  if (d.scope_type === "campaign" && d.campaign_ids.length === 0)
    return "Selecciona al menos una campaña";
  if (d.scope_type === "tags" && d.account_tags.length === 0)
    return "Selecciona al menos una etiqueta de buzón";
  if (d.category_mode === "specific" && d.categories.length === 0)
    return "Selecciona al menos una categoría de lead";
  if (d.primary_goal === "custom" && !d.custom_goal.trim())
    return "Describe el objetivo personalizado";
  const badResource = d.resources.find((r) => r.name.trim() && !r.url.trim());
  if (badResource) return `Falta el enlace del recurso "${badResource.name}"`;
  return null;
}

/** Resumen legible del alcance, para las tarjetas de la lista. */
export function scopeSummary(agent: ReplyAgent, campaignNames: Record<string, string>): string {
  const scope = agent.scope_type || "account";
  if (scope === "campaign") {
    const names = (agent.campaign_ids || []).map((id) => campaignNames[id]).filter(Boolean);
    if (names.length === 0) return "Sin campañas asignadas";
    return names.length <= 2 ? names.join(", ") : `${names.length} campañas`;
  }
  if (scope === "tags") {
    const tags = agent.account_tags || [];
    return tags.length ? `Etiquetas: ${tags.join(", ")}` : "Sin etiquetas asignadas";
  }
  return "Toda la cuenta";
}
