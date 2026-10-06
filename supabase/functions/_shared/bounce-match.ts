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

// ───────────────────────────────────────────────────────────────────────────────────────────
// Marcar, avisar y descartar un rebote (06-10-2026)
// ───────────────────────────────────────────────────────────────────────────────────────────
// Queja del dueño: "salió el aviso de rebote y me respondió". Casos reales (últimos 9 días):
//  · un rebote de 28-09 traído tarde por un repaso del buzón se colgó (lógica anterior al 04-10)
//    de una respuesta enviada el 02-10, y el lead contestó justo a esa respuesta;
//  · rebotes reales por Spamhaus (IP de salida de IONOS listada): el dueño reenvía, el reenvío sí
//    llega y el lead contesta a ése; en el hilo se ve "No entregado" junto a la respuesta.
// Reglas: se marca sólo un fallo definitivo del destinatario de ESE envío; no se marca si el lead
// ya contestó a ese mismo correo; el aviso al móvil sólo con 5.x.x y casando por Message-ID (o un
// único envío posible y reciente); y si después el lead contesta a ese correo, el rebote se descarta.

/** Identificador de mensaje normalizado: minúsculas y entre <>. */
export function normMid(mid: string | null | undefined): string {
  const v = String(mid || "").trim().toLowerCase().replace(/^<|>$/g, "");
  return v ? `<${v}>` : "";
}

/** El correo al que contesta directamente: el último identificador de la cadena (In-Reply-To va
 *  al final). Toda la cadena NO vale: un reenvío nuestro lleva en References el correo rebotado,
 *  y la respuesta del lead lo arrastra aunque nunca lo recibiera. */
export function parentRef(refChain: string | null | undefined): string {
  const ids = String(refChain || "").match(/<[^<>\s]+>/g) || [];
  return ids.length ? normMid(ids[ids.length - 1]) : "";
}

/** ¿Alguno de estos correos del destinatario contesta directamente a ese envío? */
export function repliedToSend(smtpMessageId: string | null | undefined, refChains: (string | null | undefined)[]): boolean {
  const mid = normMid(smtpMessageId);
  return !!mid && refChains.some((rc) => parentRef(rc) === mid);
}

/** Margen para avisar por destinatario (sin Message-ID): el envío tiene que ser reciente. */
export const BOUNCE_PUSH_WINDOW_MS = 72 * 3600 * 1000;

export interface BounceDecision {
  mark: boolean;
  push: boolean;
  /** Por qué no se marca (queda en el registro): temporal, otro_destinatario, respondio… */
  why: string;
}

/**
 * Con el aviso ya casado con un envío: ¿se marca como rebotado? ¿se avisa al móvil?
 * `repliedToIt`: el destinatario ya contestó a ESE correo (prueba de que llegó).
 */
export function decideBounce(
  info: { permanent: boolean; code: string; recipients: string[] },
  match: BounceMatch,
  bounceAt: string,
  repliedToIt = false,
): BounceDecision {
  const hit = match.hit;
  if (!hit) return { mark: false, push: false, why: match.how };
  if (hit.bounced_at) return { mark: false, push: false, why: "ya_marcado" };
  // Retraso (4.x.x, "delayed", "se seguirá intentando"): el servidor sigue probando.
  if (!info.permanent) return { mark: false, push: false, why: "temporal" };
  // El aviso es de OTRA dirección (una copia en CC, otro destinatario del mismo correo).
  const to = String(hit.to_email || "").toLowerCase().trim();
  const rcpts = (info.recipients || []).map((r) => r.toLowerCase().trim());
  if (to && rcpts.length > 0 && !rcpts.includes(to)) return { mark: false, push: false, why: "otro_destinatario" };
  if (repliedToIt) return { mark: false, push: false, why: "respondio" };
  const t = Date.parse(bounceAt);
  const age = Number.isFinite(t) ? t - Date.parse(hit.created_at) : Infinity;
  const exact = match.how === "message_id" || (match.how === "unico" && age <= BOUNCE_PUSH_WINDOW_MS);
  const push = !hit.campaign_id && /^5/.test(info.code || "") && exact;
  return { mark: true, push, why: "" };
}

/** Lo mínimo de un envío rebotado para decidir si una respuesta posterior lo desmiente. */
export interface BouncedSend {
  id: string;
  to_email: string | null;
  smtp_message_id: string | null;
  bounced_at: string | null;
  campaign_id: string | null;
  error_message: string | null;
  created_at: string;
}

export const BOUNCE_DISMISSED_PREFIX = "Rebote descartado: respondió";

/**
 * Una respuesta MANUAL marcada como rebotada y, después, el destinatario contesta a ESE correo:
 * el rebote era falso. Devuelve el nuevo error_message (y el que llama pone bounced_at a null) o
 * null si no hay que tocar nada.
 */
export function bounceDismissal(
  sent: BouncedSend,
  inbound: { from_email: string | null; ref_chain: string | null; received_at: string | null },
): string | null {
  if (!sent.bounced_at || sent.campaign_id) return null;
  const to = String(sent.to_email || "").toLowerCase().trim();
  const from = String(inbound.from_email || "").toLowerCase().trim();
  if (!to || to !== from) return null;
  if (!repliedToSend(sent.smtp_message_id, [inbound.ref_chain])) return null;
  const rec = Date.parse(inbound.received_at || "");
  const sentAt = Date.parse(sent.created_at);
  if (Number.isFinite(rec) && Number.isFinite(sentAt) && rec < sentAt) return null;
  const old = String(sent.error_message || "").trim();
  return (old ? `${BOUNCE_DISMISSED_PREFIX} · ${old}` : BOUNCE_DISMISSED_PREFIX).slice(0, 500);
}
