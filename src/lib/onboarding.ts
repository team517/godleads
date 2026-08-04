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
