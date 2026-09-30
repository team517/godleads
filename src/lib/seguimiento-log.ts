// Seguimiento → registro de últimos envíos y "Volver a programar follow-up". Parte pura.

export interface FollowUp {
  id: string; contact_email: string; contact_name?: string | null; subject?: string | null; body?: string | null;
  status: string; scheduled_at: string; sent_at?: string | null;
  in_reply_to?: string | null; references_hdr?: string | null; sent_message_id?: string | null;
}

export interface EnvioReciente {
  ultimo: FollowUp;          // el último follow-up enviado a esa persona
  anteriores: FollowUp[];    // los enviados antes, del más nuevo al más viejo
  enviados: number;
  programado: FollowUp | null; // el próximo que ya está en el calendario, si lo hay
}

const t = (v?: string | null) => (v ? Date.parse(v) : 0);

/** Un registro por persona (la del envío más reciente arriba), con su historial y su próximo programado. */
export function ultimosEnvios(followups: FollowUp[], max = 30): EnvioReciente[] {
  const porContacto = new Map<string, FollowUp[]>();
  for (const f of followups) {
    const k = String(f.contact_email || "").trim().toLowerCase();
    if (!k) continue;
    if (!porContacto.has(k)) porContacto.set(k, []);
    porContacto.get(k)!.push(f);
  }
  const out: EnvioReciente[] = [];
  for (const lista of porContacto.values()) {
    const enviados = lista.filter((f) => f.status === "sent").sort((a, b) => t(b.sent_at || b.scheduled_at) - t(a.sent_at || a.scheduled_at));
    if (!enviados.length) continue;
    const programado = lista.filter((f) => f.status === "scheduled").sort((a, b) => t(a.scheduled_at) - t(b.scheduled_at))[0] || null;
    out.push({ ultimo: enviados[0], anteriores: enviados.slice(1), enviados: enviados.length, programado });
  }
  return out.sort((a, b) => t(b.ultimo.sent_at || b.ultimo.scheduled_at) - t(a.ultimo.sent_at || a.ultimo.scheduled_at)).slice(0, max);
}

/** Cabeceras para que el nuevo follow-up conteste al último enviado (mismo hilo). */
export function hiloTrasUltimo(f: FollowUp): { inReplyTo: string; references: string } {
  const ids: string[] = [];
  for (const parte of [f.references_hdr, f.in_reply_to, f.sent_message_id]) {
    for (const id of String(parte || "").split(/\s+/)) if (id && !ids.includes(id)) ids.push(id);
  }
  const inReplyTo = f.sent_message_id || f.in_reply_to || "";
  return { inReplyTo, references: ids.join(" ") };
}

/**
 * Cuándo va el nuevo follow-up: 3 días laborables después de hoy (nunca sábado ni domingo), a la
 * misma hora a la que salió el último, dentro de 9:00–18:00.
 */
export function fechaReprogramacion(ultimoEnvio: string | null | undefined, ahora = new Date(), diasLaborables = 3): Date {
  const base = ultimoEnvio ? new Date(ultimoEnvio) : ahora;
  let h = base.getHours(), m = base.getMinutes();
  if (h < 9) { h = 9; m = 30; }
  if (h >= 18) { h = 17; m = 30; }
  const d = new Date(ahora);
  let quedan = diasLaborables;
  while (quedan > 0) {
    d.setDate(d.getDate() + 1);
    const dia = d.getDay();
    if (dia !== 0 && dia !== 6) quedan--;
  }
  d.setHours(h, m, 0, 0);
  return d;
}

/** Instrucción para la IA: variación del último mensaje, no uno nuevo desde cero. */
export const PISTA_VARIACION =
  "Escribe una VARIACIÓN del ÚLTIMO mensaje que le enviamos (el último NOSOTROS): mismo objetivo y mismo tipo de llamada a la acción, " +
  "pero con otras palabras y otra frase de entrada. No copies frases literales de los mensajes anteriores. " +
  "Retoma el hilo con naturalidad, como un seguimiento breve.";
