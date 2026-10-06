// Respuestas manuales que no salen o rebotan (06-10-2026).
//
// Queja del dueño: "envío un correo y me llega al móvil un aviso de error". Los casos reales:
// - Rebote 550 5.7.1 "Client host [82.165.159.x] blocked using Spamhaus": el servidor del
//   destinatario rechaza la IP de salida de IONOS que tocó en ese envío. IONOS sale por un grupo de
//   IPs; reenviar el MISMO correo desde el MISMO buzón suele salir por otra limpia (el dueño lo hizo
//   a mano y el lead contestó). Ni se cambia de remitente ni se esconde nada: es un reintento normal.
// - 451 "local error in processing" de IONOS o un plazo de conexión: fallos pasajeros al enviar.
// Lo que NO se reintenta: direcciones que no existen, buzones inactivos, rechazos por política del
// destinatario (reenvío externo prohibido, acceso denegado…) y fallos que pueden haber salido.

/** Envíos en total de una misma respuesta (el original + reenvíos automáticos). */
export const MAX_REPLY_SENDS = 3;

/** Reintentos inmediatos dentro de send-email ante un fallo pasajero (además del primer intento). */
export const INLINE_RETRY_DELAYS_MS = [4_000, 10_000];

/** Con más de esto en adjuntos (base64) no se guarda la copia para reenviar. */
export const MAX_RETRY_PAYLOAD_B64 = 3_000_000;

/**
 * ¿Un fallo de send-email AL ENVIAR merece otro intento inmediato?
 * Sí: plazos y cortes de conexión antes de mandar el mensaje, y respuestas 4xx (temporales).
 * No: "sin confirmar" (puede haber salido: reintentar lo duplicaría), credenciales (535),
 * rechazos definitivos 5xx, host no permitido, servidor sin TLS.
 */
export function sendRetryable(error: string | null | undefined): boolean {
  const e = String(error || "");
  if (!e) return false;
  if (/sin confirmar|puede haber salido/i.test(e)) return false;
  if (/^Auth failed/i.test(e) && !/:\s*4\d\d[ -]/.test(e)) return false;
  // Código SMTP que contestó el servidor (justo después de los dos puntos del mensaje).
  const code = e.match(/:\s*([2-5]\d\d)[ -]/)?.[1];
  if (code) return code.startsWith("4");
  // Sin código: fallos de red antes de DATA ("SMTP error: Timeout: connect …", "connection reset").
  return /^SMTP error:/i.test(e) && /timeout|timed out|reset|refused|broken pipe|unexpected eof|connection (closed|lost|error)|os error|network/i.test(e);
}

/** Lo que hace falta de un rebote ya leído (bounce.ts → BounceInfo). */
export interface BounceLike {
  code?: string | null;
  diag?: string | null;
  permanent?: boolean;
}

const IP_BLOCK_RE = /spamhaus|blocked using|block ?list|black ?list|\brbl\b|\bdnsbl\b|client host \[?[\d.:a-f]+\]? (is )?blocked|(sending|your|the) ip( address)? (is |has been )?(blocked|listed|banned|rejected)|listed (at|in|on|by) |poor reputation|bad reputation|ip reputation|sender ip|barracuda|sorbs|spamcop|uceprotect|mout-xforward|local error in processing|temporar(il)?y (rejected|deferred|unavailable)|try again later|greylist/i;
const DEAD_RE = /does not exist|doesn'?t exist|no such user|user unknown|unknown user|recipient ?not ?found|recipientnotfound|mailbox (unavailable|not found|does not exist)|address rejected|invalid (recipient|address|mailbox)|account (is )?(disabled|inactive|suspended)|is inactive|no longer|not a valid|5\.1\.\d|5\.2\.1|over ?quota|mailbox (is )?full|5\.2\.2|forwarding|access denied|not allowed|policy/i;

/**
 * ¿Este rebote de una respuesta manual se arregla reenviándola tal cual desde el mismo buzón?
 * Sólo cuando el rechazo es por la IP de salida (listas negras, reputación) o es pasajero. Una
 * dirección muerta o una política del destinatario fallarían igual en cada reenvío.
 */
export function bounceRetryable(b: BounceLike): boolean {
  const diag = String(b.diag || "");
  const code = String(b.code || "");
  if (IP_BLOCK_RE.test(diag)) return true;
  if (DEAD_RE.test(diag)) return false;
  // Temporal (4.x.x) sin explicación concreta: el propio servidor dice que se puede volver a probar.
  return /^4\./.test(code) || b.permanent === false;
}

/** ¿Se puede reenviar una vez más? `attempt` = reenvíos ya hechos (0 en el original). */
export function canResend(attempt: number): boolean {
  return Number.isFinite(attempt) && attempt + 1 < MAX_REPLY_SENDS;
}

/** El texto que queda en el envío rebotado cuando se reenvía solo. */
export function resentNote(reason: string): string {
  const base = String(reason || "").trim();
  const note = "Reenviado automáticamente";
  return (base.includes(note) ? base : `${base} · ${note}`).slice(0, 500);
}
