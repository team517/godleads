// Piezas puras del "cable" SMTP compartidas por send-email y _shared/smtp.ts.
//
// Auditoría 06-10-2026 (#17/#18): los lectores de respuesta daban la respuesta por buena en cuanto
// llegaba UN trozo que parecía una línea final, sin comprobar que la línea estuviese entera, y
// send-email no tenía plazos (un servidor que no contesta dejaba la función colgada y el socket
// abierto). Aquí vive lo común: plazos, presupuesto total, "¿está completa la respuesta?" y el
// saneado del texto del servidor antes de enseñarlo.

export interface ByteReader {
  read(p: Uint8Array): Promise<number | null>;
}

/** Rechaza si `p` no termina en `ms`. Limpia el temporizador (no deja timers vivos). */
export function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error(`SMTP timeout (${what})`)), Math.max(1, ms));
  });
  return Promise.race([p, limit]).finally(() => { if (timer !== undefined) clearTimeout(timer); });
}

/**
 * Presupuesto global de una sesión: cada llamada devuelve el plazo que queda para esa operación
 * (el menor entre su tope propio y lo que falte del total) o lanza si ya se agotó.
 */
export function makeBudget(totalMs: number, now: () => number = Date.now): (capMs: number) => number {
  const end = now() + totalMs;
  return (capMs: number) => {
    const left = end - now();
    if (left <= 0) throw new Error("SMTP timeout (presupuesto total)");
    return Math.min(capMs, left);
  };
}

/**
 * ¿Está COMPLETA la respuesta SMTP acumulada? Sólo si el buffer acaba en CRLF y su última línea
 * es la final ("NNN " con espacio, o el código solo; las de continuación son "NNN-").
 * Un trozo cortado a mitad de línea ("250 OK" sin CRLF) NO cuenta como completo.
 */
export function isCompleteSmtpReply(buf: string): boolean {
  if (!buf || !buf.endsWith("\r\n")) return false;
  const lines = buf.split("\r\n");
  // El último elemento es "" (lo que hay tras el CRLF final): la última línea real es la anterior.
  const last = lines[lines.length - 2] ?? "";
  return /^\d{3} /.test(last) || /^\d{3}$/.test(last);
}

/** Código numérico de la última línea de una respuesta ya completa (0 si no se reconoce). */
export function smtpReplyCode(buf: string): number {
  const lines = (buf || "").split("\r\n").filter((l) => l.length > 0);
  const m = (lines[lines.length - 1] || "").match(/^(\d{3})/);
  return m ? Number(m[1]) : 0;
}

/**
 * Lee UNA respuesta SMTP entera. Plazo por lectura (`readMs`) y, si se da, presupuesto global.
 * Si el servidor cierra la conexión devuelve lo acumulado; si manda más de `maxBytes` sin cerrar
 * la respuesta, lanza (no se acumula basura sin fin).
 */
export async function readSmtpReply(
  getReader: () => ByteReader,
  opts: { readMs: number; budget?: (capMs: number) => number; maxBytes?: number },
): Promise<string> {
  const dec = new TextDecoder("utf-8", { fatal: false });
  const maxBytes = opts.maxBytes ?? 64 * 1024;
  let result = "";
  let total = 0;
  while (true) {
    const buf = new Uint8Array(4096);
    const ms = opts.budget ? opts.budget(opts.readMs) : opts.readMs;
    const n = await withTimeout(getReader().read(buf), ms, "read");
    if (!n) break;
    total += n;
    result += dec.decode(buf.subarray(0, n), { stream: true });
    if (isCompleteSmtpReply(result)) break;
    if (total > maxBytes) throw new Error("respuesta SMTP demasiado larga");
  }
  return result;
}

/**
 * Texto de un servidor remoto para mostrar a un usuario: una línea, sin binarios ni control,
 * limitada. Nunca devolver al cliente la respuesta cruda de un host elegido por el usuario.
 */
export function sanitizeServerText(raw: unknown, max = 120): string {
  const s = String(raw ?? "").replace(/[^\x20-\x7E]+/g, " ").replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}
