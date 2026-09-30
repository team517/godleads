// Agentes IA (antes "IA"): cada agente de respuestas (auto_reply_rules) y cada asistente del Unibox
// (ai_prompts) es una tarjeta. Parte pura: estado, etiquetas, cifras y la gráfica de actividad,
// siempre con datos reales (nada inventado: un agente sin actividad enseña una línea plana).

export type AgentKind = "reply" | "assistant";
export type AgentStatus = "active" | "paused" | "draft";

export interface AgentCard {
  id: string;
  kind: AgentKind;
  name: string;
  description: string;
  status: AgentStatus;
  tags: string[];
  /** Actividad por día, del más viejo al de hoy. */
  series: number[];
  metricA: { value: number; label: string };
  metricB: { value: number; label: string };
}

export interface ReplyRule {
  id: string; name: string; is_active: boolean; reply_mode?: string | null; primary_goal?: string | null;
  custom_goal?: string | null; category_mode?: string | null; categories?: string[] | null;
}
export interface ReplyLogRow { rule_id: string | null; status: string; created_at: string }
export interface PromptRow { id: string; name: string; company_info?: string | null; prompt?: string | null; tags?: string[] | null }

export const DIAS_GRAFICA = 14;
const GOALS: Record<string, string> = {
  book_meeting: "Consigue reuniones",
  share_info: "Comparte información",
  qualify: "Cualifica a los leads",
  custom: "Objetivo personalizado",
};
const REPLYABLE = ["Interesado", "Pregunta", "Derivado"];

/** Cuántos registros hay por día en los últimos `dias` días (hoy incluido, hora local). */
export function serieDiaria(fechas: string[], ahora = new Date(), dias = DIAS_GRAFICA): number[] {
  const hoy = new Date(ahora); hoy.setHours(0, 0, 0, 0);
  const out = new Array(dias).fill(0);
  for (const f of fechas) {
    const d = new Date(f); d.setHours(0, 0, 0, 0);
    const idx = dias - 1 - Math.round((hoy.getTime() - d.getTime()) / 86_400_000);
    if (idx >= 0 && idx < dias) out[idx]++;
  }
  return out;
}

/** `logs` = actividad de los últimos días (gráfica y enviadas); `pendientes` = borradores sin
 *  revisar por agente (de toda la vida), si se tienen. */
export function tarjetasRespuesta(rules: ReplyRule[], logs: ReplyLogRow[], ahora = new Date(), pendientes?: Record<string, number>): AgentCard[] {
  return rules.map((r) => {
    const mine = logs.filter((l) => l.rule_id === r.id);
    const auto = r.reply_mode === "auto";
    const cats = r.category_mode === "all" ? REPLYABLE : (r.categories || []);
    const goal = r.primary_goal === "custom" && r.custom_goal ? r.custom_goal : GOALS[r.primary_goal || "book_meeting"] || GOALS.book_meeting;
    return {
      id: r.id,
      kind: "reply" as const,
      name: r.name || "Agente de respuestas",
      description: `${goal}. ${auto ? "Contesta solo a tus leads" : "Te deja borradores para revisar"} cuando responden.`,
      status: r.is_active ? "active" as const : "paused" as const,
      tags: [auto ? "Envío automático" : "Borradores", ...cats].slice(0, 3),
      series: serieDiaria(mine.map((l) => l.created_at), ahora),
      metricA: { value: mine.filter((l) => l.status === "sent").length, label: "Enviadas · 14 días" },
      metricB: { value: pendientes ? pendientes[r.id] || 0 : mine.filter((l) => l.status === "draft").length, label: "Borradores" },
    };
  });
}

export function tarjetasAsistente(prompts: PromptRow[], cuentasConTag: Record<string, number>): AgentCard[] {
  return prompts.map((p) => {
    const tags = p.tags || [];
    const cuentas = tags.reduce((n, t) => n + (cuentasConTag[t] || 0), 0);
    const info = String(p.company_info || p.prompt || "").replace(/\s+/g, " ").trim();
    return {
      id: p.id,
      kind: "assistant" as const,
      name: p.name || "Asistente del Unibox",
      description: info ? info.slice(0, 140) : "Sugiere respuestas en el Unibox para los buzones con sus etiquetas.",
      status: tags.length ? "active" as const : "draft" as const,
      tags: tags.length ? tags.slice(0, 3) : ["Sin etiquetas"],
      series: new Array(DIAS_GRAFICA).fill(0),
      metricA: { value: tags.length, label: tags.length === 1 ? "Etiqueta" : "Etiquetas" },
      metricB: { value: cuentas, label: cuentas === 1 ? "Buzón" : "Buzones" },
    };
  });
}

export interface Filtro { q: string; kind: AgentKind | "all"; status: AgentStatus | "all" }

export function filtrarAgentes(cards: AgentCard[], f: Filtro): AgentCard[] {
  const q = f.q.trim().toLowerCase();
  return cards.filter((c) =>
    (f.kind === "all" || c.kind === f.kind)
    && (f.status === "all" || c.status === f.status)
    && (!q || `${c.name} ${c.description} ${c.tags.join(" ")}`.toLowerCase().includes(q)));
}

/** Línea suave (y su área) para la mini gráfica de la tarjeta. Sin datos → línea plana abajo. */
export function curvaActividad(series: number[], w = 300, h = 56, pad = 6): { line: string; area: string; vacia: boolean } {
  const n = series.length;
  const max = Math.max(0, ...series);
  const vacia = max === 0;
  const pts = series.map((v, i) => {
    const x = n <= 1 ? 0 : (i / (n - 1)) * w;
    const y = vacia ? h - pad : h - pad - (v / max) * (h - pad * 2);
    return [Math.round(x * 10) / 10, Math.round(y * 10) / 10] as const;
  });
  if (!pts.length) return { line: "", area: "", vacia: true };
  let line = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const cx = Math.round(((x0 + x1) / 2) * 10) / 10;
    line += ` C${cx},${y0} ${cx},${y1} ${x1},${y1}`;
  }
  const area = `${line} L${pts[pts.length - 1][0]},${h} L${pts[0][0]},${h} Z`;
  return { line, area, vacia };
}
