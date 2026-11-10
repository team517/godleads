// Chip "Fuera · vuelve el 15 nov" en los leads de una campaña que esperan a que vuelva quien respondió
// con un fuera de oficina (10-11-2026). Puro, con prueba.

export interface EsperaOoo { lead_id: string; return_date: string | null; scheduled_for: string | null; snippet: string | null }

/** "Fuera · vuelve el 15 nov" (o "Fuera · vuelve pronto" si no hay día guardado). */
export function textoVuelta(returnDate: string | null | undefined): string {
  if (!returnDate || !/^\d{4}-\d{2}-\d{2}$/.test(returnDate)) return "Fuera · vuelve pronto";
  const d = new Date(`${returnDate}T12:00:00Z`);
  const dia = d.toLocaleDateString("es-ES", { day: "numeric", month: "short", timeZone: "UTC" }).replace(".", "");
  return `Fuera · vuelve el ${dia}`;
}

/** Tooltip: qué dijo y cuándo se le vuelve a escribir. */
export function tooltipVuelta(e: EsperaOoo): string {
  const cuando = e.scheduled_for
    ? new Date(e.scheduled_for).toLocaleString("es-ES", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" })
    : null;
  const partes = [cuando ? `Siguiente correo: ${cuando}` : null, e.snippet ? `Su respuesta: "${e.snippet.slice(0, 240)}${e.snippet.length > 240 ? "…" : ""}"` : null];
  return partes.filter(Boolean).join("\n");
}

/** De las filas leídas, las esperas que siguen vigentes, por lead. */
export function esperasPorLead(filas: EsperaOoo[], nowMs = Date.now()): Record<string, EsperaOoo> {
  const out: Record<string, EsperaOoo> = {};
  for (const f of filas) {
    if (!f.lead_id || !f.scheduled_for || Date.parse(f.scheduled_for) <= nowMs) continue;
    const prev = out[f.lead_id];
    if (!prev || Date.parse(f.scheduled_for) > Date.parse(prev.scheduled_for || "")) out[f.lead_id] = f;
  }
  return out;
}
