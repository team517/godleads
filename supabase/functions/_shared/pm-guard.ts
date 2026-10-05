// Freno del {{personalized_message}} (05-10-2026, petición del dueño).
//
// Si un paso (o una variante) envía {{personalized_message}} y el lead NO tiene uno válido —vacío o
// el texto de un error de la IA ("[ERROR: fetch failed]", "[ERROR: DeepSeek API 402…]")—, ese
// correo no puede salir: saldría vacío o con el error (ya pasó: 32 correos de OnControl).
//   · Si el paso tiene otra variante que NO usa la variable → se envía esa.
//   · Si no hay ninguna → no se envía nada (el motor saca al lead de la cola).
// Puro, sin dependencias, para probarlo (src/test/pm-guard.test.ts).

/** La variable en una plantilla, como la reconoce replaceVariables (mayúsculas, _, - o espacio). */
const PM_VAR_RE = /\{\{\s*personali[sz]ed[\s_-]*message\s*\}\}/i;

/** ¿Esta plantilla (asunto o cuerpo) usa {{personalized_message}}? */
export function usesPersonalizedMessage(v: { subject?: string | null; body?: string | null }): boolean {
  return PM_VAR_RE.test(String(v?.body ?? "")) || PM_VAR_RE.test(String(v?.subject ?? ""));
}

/** El personalized_message del lead, venga con la clave escrita como venga. */
export function personalizedMessageOf(customFields: Record<string, unknown> | null | undefined): string {
  const cf = customFields || {};
  for (const [k, v] of Object.entries(cf)) {
    if (k.toLowerCase().replace(/[^a-z]/g, "").replace("personalised", "personalized") === "personalizedmessage") {
      const s = typeof v === "string" ? v : v == null ? "" : String(v);
      if (s.trim()) return s;
    }
  }
  return "";
}

/** ¿El lead tiene un personalized_message que se pueda enviar? */
export function hasUsablePersonalizedMessage(customFields: Record<string, unknown> | null | undefined): boolean {
  const pm = personalizedMessageOf(customFields).trim();
  if (!pm) return false;
  if (/^\[?\s*error\b/i.test(pm)) return false;           // "[ERROR: fetch failed]", "ERROR: …"
  if (/^\[ERROR/i.test(pm.replace(/<[^>]+>/g, "").trim())) return false;
  return true;
}

/**
 * De las variantes elegibles (índices sobre [base, ...variantes]), las que se pueden enviar a este
 * lead. Con un personalized_message válido, todas; si no, sólo las que no usan la variable.
 * Lista vacía = no se puede enviar nada a este lead en este paso.
 */
export function sendableVariantIdx(
  allVariants: { subject?: string | null; body?: string | null }[],
  eligibleIdx: number[],
  customFields: Record<string, unknown> | null | undefined,
): number[] {
  if (hasUsablePersonalizedMessage(customFields)) return eligibleIdx;
  return eligibleIdx.filter((i) => allVariants[i] && !usesPersonalizedMessage(allVariants[i]));
}
