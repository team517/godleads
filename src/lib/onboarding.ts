// ── Onboarding: 6 fixed phases shared by the owner page and the public client portal ──
// Single source of truth so the client sees EXACTLY the same phases the owner updates.
// The order here IS the canonical order; onboarding_status is an array aligned to it.

export type PhaseState = "pending" | "in_progress" | "done";

export interface Phase {
  key: string;
  title: string;
  description: string;
}

/** The 6 fixed phases of a OnePulso cold-email onboarding, in order. */
export const PHASES: Phase[] = [
  {
    key: "kickoff",
    title: "Kickoff y estrategia",
    description: "Reunión inicial, objetivos, buyer persona y definición de la oferta.",
  },
  {
    key: "infra",
    title: "Dominios y buzones",
    description: "Compra de dominios, configuración de SPF/DKIM/DMARC y creación de las cuentas de envío.",
  },
  {
    key: "warmup",
    title: "Calentamiento",
    description: "Warmup de las cuentas para maximizar la entregabilidad antes de empezar a enviar.",
  },
  {
    key: "leads",
    title: "Listas y segmentación",
    description: "Búsqueda y verificación de leads, segmentación por cliente ideal (ICP).",
  },
  {
    key: "copy",
    title: "Copywriting y secuencias",
    description: "Redacción de los correos, secuencias de seguimiento y pruebas A/B.",
  },
  {
    key: "launch",
    title: "Lanzamiento y optimización",
    description: "Campañas activas, seguimiento de respuestas en el Unibox y optimización continua.",
  },
];

export const STATE_META: Record<PhaseState, { label: string; badge: string; dot: string; weight: number }> = {
  pending: {
    label: "Pendiente",
    badge: "bg-muted text-muted-foreground border-border",
    dot: "bg-muted-foreground/40",
    weight: 0,
  },
  in_progress: {
    label: "En curso",
    badge: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-400 dark:border-amber-500/30",
    dot: "bg-amber-500",
    weight: 0.5,
  },
  done: {
    label: "Completado",
    badge: "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-400 dark:border-emerald-500/30",
    dot: "bg-emerald-500",
    weight: 1,
  },
};

export const NEXT_STATE: Record<PhaseState, PhaseState> = {
  pending: "in_progress",
  in_progress: "done",
  done: "pending",
};

/** Coerce whatever is stored (or nothing) into a clean array of 6 states, aligned to PHASES. */
export function normalizeStatus(raw: unknown): PhaseState[] {
  const arr = Array.isArray(raw) ? raw : [];
  return PHASES.map((_, i) => {
    const v = arr[i];
    return v === "done" || v === "in_progress" || v === "pending" ? v : "pending";
  });
}

/** 0–100 progress: a done phase counts full, an in-progress phase counts half. */
export function progressPct(status: PhaseState[]): number {
  const s = normalizeStatus(status);
  const total = s.reduce((acc, st) => acc + STATE_META[st].weight, 0);
  return Math.round((total / PHASES.length) * 100);
}

const esc = (s: string) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

/** Client-facing email when the owner moves a phase to "en curso" or "completado". */
export function buildPhaseEmail(opts: {
  state: "in_progress" | "done";
  phaseTitle: string;
  phaseIndex: number;   // 0-based
  companyName?: string | null;
  pct: number;
  portalUrl?: string | null;
  accent?: string | null;
  nextPhaseTitle?: string | null; // shown on a "completado" email as the next task
}): { subject: string; html: string } {
  const accent = opts.accent || "#6E58F1";
  const company = (opts.companyName || "").trim();
  const brand = company || "tu proyecto";
  const n = opts.phaseIndex + 1;
  const hasNext = opts.state === "done" && !!(opts.nextPhaseTitle && opts.nextPhaseTitle.trim());
  const allDone = opts.state === "done" && !hasNext && opts.pct >= 100;

  const subject = opts.state === "done"
    ? (allDone ? `🎉 ${brand} · ¡Onboarding completado!` : `✅ ${brand} · Fase completada: ${opts.phaseTitle}`)
    : `🚧 ${brand} · Fase en curso: ${opts.phaseTitle}`;

  const intro = opts.state === "done"
    ? (allDone
        ? "¡Buenas noticias! Hemos completado la última fase de tu proyecto."
        : "¡Buenas noticias! Hemos completado una fase de tu proyecto:")
    : "Hemos empezado a trabajar en una nueva fase de tu proyecto:";
  const stateLabel = opts.state === "done" ? "Completada ✅" : "En curso 🚧";

  const nextLine = hasNext
    ? `<p style="margin:0 0 14px">Ya nos ponemos con la siguiente fase: <strong>${esc(opts.nextPhaseTitle!.trim())}</strong>. Te iremos informando.</p>`
    : "";

  const button = opts.portalUrl
    ? `<p style="margin:20px 0"><a href="${esc(opts.portalUrl)}" style="display:inline-block;background:${esc(accent)};color:#ffffff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:600;font-size:14px">Ver mi progreso</a></p>`
    : "";

  const congrats = allDone
    ? `<p style="margin:16px 0;font-size:15px">🎉 Con esto hemos completado <strong>todas las fases</strong> de tu onboarding. ¡Encantados de tenerte a bordo!</p>`
    : "";

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#1f2937;line-height:1.55;font-size:15px">
  <p style="margin:0 0 14px">Hola,</p>
  <p style="margin:0 0 14px">${intro}</p>
  <div style="border-left:4px solid ${esc(accent)};background:#f8fafc;padding:12px 16px;margin:0 0 16px;border-radius:6px">
    <div style="font-weight:700;font-size:16px">Fase ${n}: ${esc(opts.phaseTitle)}</div>
    <div style="color:#6b7280;font-size:14px;margin-top:2px">${stateLabel}</div>
  </div>
  ${nextLine}
  <p style="margin:0 0 4px">Progreso de tu proyecto: <strong style="color:${esc(accent)}">${opts.pct}%</strong> completado.</p>
  <div style="height:8px;background:#eceef2;border-radius:99px;overflow:hidden;margin:8px 0 4px">
    <div style="height:8px;width:${opts.pct}%;background:${esc(accent)}"></div>
  </div>
  ${congrats}
  ${button}
  <p style="color:#9ca3af;font-size:12px;margin-top:26px">Aviso automático sobre el progreso de tu onboarding${company ? ` con ${esc(company)}` : ""}.</p>
</div>`;

  return { subject, html };
}
