// Estado de verificación que traen las listas (Apollo, ZeroBounce, NeverBounce, MillionVerifier…)
// al importarlas (19-10-2026). Se guarda en leads.verification_status ('valid' | 'risky' | 'invalid'),
// la misma columna que usa la verificación de la app, y el motor NO envía el primer correo a los
// 'invalid'. Antes esa columna del CSV se perdía (o se quedaba como variable sin usar).

export type LeadVerification = "valid" | "risky" | "invalid";

const COLUMN_RE = /^(email[\s_-]*(status|verification|verified|validity|validation)|verification[\s_-]*status|e?mail[\s_-]*estado|estado[\s_-]*(del[\s_-]*)?e?mail|zb[\s_-]*status|result|resultado)$/i;

/** La columna del CSV con el estado del email, si la hay (la primera que encaje). */
export function findEmailStatusColumn(headers: readonly string[]): string | null {
  for (const h of headers) if (COLUMN_RE.test(String(h || "").trim())) return h;
  return null;
}

/** Valor del proveedor → nuestro estado. Desconocido o vacío → null (no se toca). */
export function normalizeEmailStatus(raw: string | null | undefined): LeadVerification | null {
  const v = String(raw ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!v) return null;
  if (/^(valid|verified|deliverable|ok|safe|good|valido|válido|verificado)$/.test(v)) return "valid";
  if (/^(invalid|unavailable|bounced?|undeliverable|do_not_mail|spamtrap|spam_trap|disposable|abuse|syntax_error|bad|invalido|inválido|no_valido|no_existe)$/.test(v)) return "invalid";
  if (/^(guessed|extrapolated|catch_?all|accept_?all|risky|unknown|likely_to_engage|pending|pending_manual_fulfillment|unverified|role|riesgo|dudoso|desconocido)$/.test(v)) return "risky";
  return null;
}

/** El estado de una fila del CSV (o null si no trae columna o valor reconocible). */
export function rowEmailStatus(row: Record<string, string | undefined>, column: string | null): LeadVerification | null {
  return column ? normalizeEmailStatus(row[column]) : null;
}
