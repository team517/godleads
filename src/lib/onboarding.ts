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

/**
 * Predetermined (NON-AI) editable draft for a phase change. Returns plain-text
 * subject + body that the owner reviews in a compose box and sends. Newlines are
 * turned into paragraphs by the send-email function.
 */
export function phaseEmailDraft(opts: {
  state: "in_progress" | "done";
  phaseTitle: string;
  phaseIndex: number;   // 0-based
  companyName?: string | null;
  pct: number;
  portalUrl?: string | null;
  nextPhaseTitle?: string | null;
}): { subject: string; body: string } {
  const hasNext = opts.state === "done" && !!(opts.nextPhaseTitle && opts.nextPhaseTitle.trim());
  const allDone = opts.state === "done" && !hasNext && opts.pct >= 100;
  const link = opts.portalUrl ? `\n\nPuedes seguir tu progreso en tiempo real aquí:\n${opts.portalUrl}` : "";
  const sign = "\n\nUn saludo,\nEl equipo";

  if (opts.state === "in_progress") {
    return {
      subject: `Fase en curso: ${opts.phaseTitle}`,
      body: `Hola,\n\nHemos empezado a trabajar en una nueva fase de tu proyecto: "${opts.phaseTitle}". Te iremos informando de cómo avanza.\n\nProgreso actual: ${opts.pct}%.${link}${sign}`,
    };
  }
  if (allDone) {
    return {
      subject: `¡Onboarding completado!`,
      body: `Hola,\n\n¡Buenas noticias! Hemos completado la última fase de tu onboarding. Tu proyecto ya está en marcha al 100%.${link}${sign}`,
    };
  }
  const nextLine = hasNext ? ` Ya nos ponemos con la siguiente: "${opts.nextPhaseTitle!.trim()}".` : "";
  return {
    subject: `Fase completada: ${opts.phaseTitle}`,
    body: `Hola,\n\n¡Buenas noticias! Hemos completado la fase "${opts.phaseTitle}" de tu proyecto.${nextLine}\n\nProgreso actual: ${opts.pct}%.${link}${sign}`,
  };
}

/** Predetermined editable draft to send the client their access credentials. */
export function credentialsEmailDraft(opts: {
  companyName?: string | null;
  portalUrl?: string | null;
  email: string;
  password?: string | null;
}): { subject: string; body: string } {
  const brand = (opts.companyName || "").trim();
  const lines: string[] = [
    "Hola,",
    "",
    `Ya puedes acceder a tu portal de onboarding${brand ? ` de ${brand}` : ""}. Estos son tus datos de acceso:`,
    "",
  ];
  if (opts.portalUrl) lines.push(`Enlace: ${opts.portalUrl}`);
  lines.push(`Email: ${opts.email}`);
  lines.push(`Contraseña: ${opts.password || "(la que te facilitamos)"}`);
  lines.push("");
  lines.push("Con estas mismas credenciales puedes entrar también a la plataforma completa.");
  lines.push("\nUn saludo,\nEl equipo");
  return {
    subject: `Tus accesos${brand ? ` · ${brand}` : ""}`,
    body: lines.join("\n"),
  };
}
