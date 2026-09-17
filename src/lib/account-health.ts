// Veredicto de configuración de una cuenta de envío: ¿está el dominio bien autenticado?
// Lógica pura (sin red ni React) para poder probarla: es lo que decide el color de la fila en
// la tabla de "Cuentas de Email", en lugar de las columnas de warm-up que enseña Smartlead.

export type AuthStatus = "pass" | "warn" | "fail";

export interface DomainAuthLike {
  loading?: boolean;
  error?: boolean;
  spf?: AuthStatus;
  dkim?: AuthStatus;
  dmarc?: AuthStatus;
}

export type ConfigLevel = "ok" | "warn" | "bad" | "checking" | "unknown";

export interface ConfigVerdict {
  level: ConfigLevel;
  /** Texto corto para la celda ("Todo correcto", "Falta DKIM"…). */
  label: string;
  /** Registros que faltan, en el orden en que se enseñan. */
  missing: string[];
  /** Registros que existen pero conviene revisar. */
  review: string[];
  /** ¿Merece ofrecer el botón "Configurar DNS"? */
  canFix: boolean;
}

const NAMES: Array<["spf" | "dkim" | "dmarc", string]> = [["spf", "SPF"], ["dkim", "DKIM"], ["dmarc", "DMARC"]];

/** Resume SPF + DKIM + DMARC en una sola frase. Sin dominio no hay veredicto posible. */
export function configVerdict(domain: string | null | undefined, auth: DomainAuthLike | null | undefined): ConfigVerdict {
  const none = { missing: [], review: [], canFix: false };
  if (!domain) return { level: "unknown", label: "Sin dominio", ...none };
  if (!auth) return { level: "checking", label: "En cola…", ...none };
  if (auth.loading) return { level: "checking", label: "Comprobando…", ...none };
  if (auth.error) return { level: "unknown", label: "Sin verificar", ...none, canFix: true };

  const missing = NAMES.filter(([k]) => auth[k] === "fail").map(([, n]) => n);
  const review = NAMES.filter(([k]) => auth[k] === "warn").map(([, n]) => n);
  const unknown = NAMES.filter(([k]) => auth[k] === undefined).map(([, n]) => n);

  if (missing.length > 0) {
    return { level: "bad", label: `Falta ${missing.join(" y ")}`, missing, review, canFix: true };
  }
  if (review.length > 0) {
    return { level: "warn", label: `Revisar ${review.join(" y ")}`, missing, review, canFix: true };
  }
  if (unknown.length === NAMES.length) return { level: "unknown", label: "Sin verificar", missing, review, canFix: true };
  if (unknown.length > 0) {
    return { level: "warn", label: `Sin datos de ${unknown.join(" y ")}`, missing, review, canFix: true };
  }
  return { level: "ok", label: "Todo correcto", missing, review, canFix: false };
}

/** Cuántas cuentas hay en cada estado, para el resumen de la cabecera. */
export function configSummary(rows: Array<{ domain: string; auth: DomainAuthLike | undefined }>): Record<ConfigLevel, number> {
  const out: Record<ConfigLevel, number> = { ok: 0, warn: 0, bad: 0, checking: 0, unknown: 0 };
  for (const r of rows) out[configVerdict(r.domain, r.auth).level]++;
  return out;
}
