// Qué envío nuestro es el que rebotó. Sin base de datos: fetch-inbox trae los candidatos
// (RPC bounce_candidates) y aquí se elige, para poder probarlo.
//
// 03-10-2026: se cogía "el último envío a ese destinatario". Un rebote tardío (IONOS avisó 2 h
// después de un correo con un enlace bloqueado) se colgó de una respuesta POSTERIOR al mismo
// destinatario que sí había llegado, y el dueño recibió un "No entregado" falso. Ahora:
//  1. el Message-ID del correo devuelto manda (es el envío exacto);
//  2. sin él, por destinatario sólo si hay UN envío anterior posible, o el asunto lo señala, o
//     todos los candidatos son del mismo lead en la misma campaña (la estadística es la misma);
//  3. con dudas, no se marca nada: mejor un rebote anotado sin envío que un envío bueno marcado.

export interface BounceCandidate {
  id: string;
  lead_id: string | null;
  campaign_id: string | null;
  bounced_at: string | null;
  user_id: string | null;
  to_email: string | null;
  subject: string | null;
  created_at: string;
  /** Por qué es candidato: su Message-ID es el del correo devuelto, o sólo coincide el destinatario. */
  how: "message_id" | "destinatario";
}

export type BounceMatchHow = "message_id" | "unico" | "asunto" | "mismo_lead" | "ambiguo" | "ninguno";

export interface BounceMatch {
  hit: BounceCandidate | null;
  how: BounceMatchHow;
  /** Cuántos envíos podían ser (para dejarlo anotado cuando no se elige ninguno). */
  candidates: number;
}

/** Un envío no puede rebotar antes de existir; margen por relojes y por el orden en que se guarda. */
export const BOUNCE_CLOCK_SLACK_MS = 15 * 60 * 1000;
/** Un rebote tardío llega días después: los servidores reintentan hasta ~5 días. */
export const BOUNCE_LOOKBACK_MS = 14 * 24 * 3600 * 1000;

const normSubject = (s: string | null | undefined) =>
  (s || "").toLowerCase().replace(/^(\s*(re|fwd?|rv|aw|wg|tr)\s*:\s*)+/i, "").replace(/\s+/g, " ").trim();

const newestFirst = (a: BounceCandidate, b: BounceCandidate) => Date.parse(b.created_at) - Date.parse(a.created_at);

export function chooseBouncedSend(
  cands: BounceCandidate[],
  bounceAt: string,
  original?: { message_id?: string; subject?: string },
): BounceMatch {
  const byId = cands.filter((c) => c.how === "message_id").sort(newestFirst);
  if (byId.length > 0) return { hit: byId[0], how: "message_id", candidates: byId.length };

  const t = Date.parse(bounceAt);
  const before = cands
    .filter((c) => c.how === "destinatario" && (!Number.isFinite(t) || Date.parse(c.created_at) < t + BOUNCE_CLOCK_SLACK_MS))
    .sort(newestFirst);
  if (before.length === 0) return { hit: null, how: "ninguno", candidates: 0 };
  if (before.length === 1) return { hit: before[0], how: "unico", candidates: 1 };

  const subj = normSubject(original?.subject);
  if (subj) {
    const same = before.filter((c) => normSubject(c.subject) === subj);
    if (same.length === 1) return { hit: same[0], how: "asunto", candidates: before.length };
  }
  const key = (c: BounceCandidate) => `${c.campaign_id || ""}|${c.lead_id || ""}`;
  if (before[0].campaign_id && before.every((c) => key(c) === key(before[0]))) {
    return { hit: before[0], how: "mismo_lead", candidates: before.length };
  }
  return { hit: null, how: "ambiguo", candidates: before.length };
}
