// Bounce (DSN / NDR) classification — pure and dependency-free so it can be unit-tested.
// Kept out of fetch-inbox/index.ts because getting this wrong is expensive: suppressing a
// recipient hides their whole conversation, and the mistake is silent.

/** Check if a sender is automated/spam */
export function isAutomatedSender(email: string): boolean {
  const patterns = [/noreply@/i, /no-reply@/i, /mailer-daemon@/i, /postmaster@/i, /bounce@/i];
  return patterns.some(p => p.test(email));
}

/**
 * Detect an async bounce (mailer-daemon DSN / NDR) and return the PERMANENTLY
 * failed recipient addresses. Only permanent (5.x.x / 55x) failures are returned
 * so a temporary greylist (4.x.x) never suppresses a good lead.
 */
export function extractPermanentBounceRecipients(fromEmail: string, subject: string, rawBody: string): string[] {
  const from = (fromEmail || "").toLowerCase();
  const looksLikeDaemon = /mailer-daemon@|postmaster@|@.*mail.*daemon/i.test(from);
  const subjBounce = /undeliverable|undelivered|delivery status|returned mail|returned to sender|mail delivery (failed|subsystem)|failure notice|delivery has failed|no se pudo entregar|correo no entregado|delivery incomplete/i.test(subject || "");
  const bodyDsn = /Content-Type:\s*message\/delivery-status|Diagnostic-Code:|Final-Recipient:|This is the mail system at host|delivery to the following recipient|could not be delivered/i.test(rawBody || "");
  if (!looksLikeDaemon && !subjBounce && !bodyDsn) return [];

  // Only act on PERMANENT failures. Look for a 5.x.x status or a 55x SMTP code.
  const permanent =
    /Status:\s*5\.\d+\.\d+/i.test(rawBody) ||
    /Diagnostic-Code:[^\n]*\b(5\d\d|5\.\d+\.\d+)\b/i.test(rawBody) ||
    /\b55[0-9]\b[^\n]*(unknown|does not exist|no such user|not found|invalid|rejected|disabled|unavailable)/i.test(rawBody);
  const temporary = /Status:\s*4\.\d+\.\d+/i.test(rawBody);
  if (!permanent || temporary) return [];

  // A permanent 5.x.x is NOT proof the address is dead. Most 5.7.x are the RECEIVING server
  // refusing US — spam policy, reputation, DMARC, a full mailbox, an oversized message. Those
  // must never suppress the lead: it cost a real "Interesado" (a prospect answered, our reply
  // was policy-rejected minutes later, and the bounce suppressed him — which then archived his
  // reply and wiped him from the Unibox). Only judge the diagnostic lines, not the whole quoted
  // email, or a phrase from OUR OWN copy underneath decides it.
  const diagLines: string[] = [
    ...(rawBody.match(/^(?:Status|Diagnostic-Code|Action|Remote-MTA):[^\n]*/gim) || []),
    ...(rawBody.match(/^[^\n]*\b5[0-9]{2}[ -][^\n]*/gim) || []),
  ];
  const diag = diagLines.join("\n");
  const RECIPIENT_GONE =
    /5\.1\.[0-6]\b|user unknown|unknown user|no such user|no such recipient|does not exist|doesn'?t exist|recipient (address )?(not found|unknown)|invalid recipient|mailbox (unavailable|not found|does not exist)|address (unknown|not found)|no mailbox here|destinatario (desconocido|no existe|inexistente)|usuario desconocido|cuenta (inexistente|no existe)|account (has been )?(disabled|deleted|closed|inactive)/i;
  const NOT_THE_ADDRESSES_FAULT =
    /5\.7\.\d|spam|policy|blocked|black\s*list|block\s*list|reputation|greylist|rate limit|too many|content rejected|virus|dmarc|spf|dkim|quota|mailbox full|too large|size limit|access denied|not authorized|relay access/i;
  // Ambiguous (both patterns present) → do nothing. A false negative just means we email a dead
  // address a while longer; a false positive silently buries a live prospect.
  if (!RECIPIENT_GONE.test(diag) || NOT_THE_ADDRESSES_FAULT.test(diag)) return [];

  const emails = new Set<string>();
  const push = (e?: string | null) => {
    const v = (e || "").trim().toLowerCase().replace(/^<|>$/g, "");
    if (/^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$/.test(v) && !isAutomatedSender(v)) emails.add(v);
  };
  // DSN standard fields (most reliable)
  for (const m of rawBody.matchAll(/(?:Final|Original)-Recipient:\s*(?:rfc822;)?\s*<?([^\s<>;]+@[^\s<>;]+)>?/gi)) push(m[1]);
  for (const m of rawBody.matchAll(/X-Failed-Recipients:\s*<?([^\s<>;,]+@[^\s<>;,]+)>?/gi)) push(m[1]);
  return Array.from(emails);
}

// ───────────────────────────────────────────────────────────────────────────────────────────
// Ficha de un rebote (02-10-2026)
// ───────────────────────────────────────────────────────────────────────────────────────────
// extractPermanentBounceRecipients (arriba) sólo contesta "¿a quién dejo de escribir?". Todo lo
// demás —rebotes por política o spam, buzón lleno, retrasos— se tiraba sin dejar rastro, así que
// un servidor que nos rechazaba por spam era invisible. bounceInfo describe CUALQUIER rebote para
// poder anotarlo: a quién iba, con qué código y de qué clase es. No decide suprimir a nadie.

export type BounceClass = "recipient_gone" | "policy" | "temporary" | "other";

export interface BounceInfo {
  recipients: string[];
  /** "5.1.1", "4.4.7", "550"… o "" si el aviso no trae código. */
  code: string;
  cls: BounceClass;
  /** false = aviso de retraso (4.x.x): el servidor sigue intentándolo. */
  permanent: boolean;
  /** La línea de diagnóstico, recortada, para leerla sin abrir el correo. */
  diag: string;
  /** El correo devuelto (la copia que viaja debajo del aviso): con su Message-ID el rebote se cuelga del envío exacto. */
  original: ReturnedOriginal;
}

export interface ReturnedOriginal {
  /** "<id@dominio>" tal cual lo mandamos, o "" si el aviso no devuelve las cabeceras del original. */
  message_id: string;
  /** Asunto del original tal cual viene (imap-parse decodifica las palabras MIME). */
  subject: string;
}

// Dónde empieza, dentro del aviso, la copia del correo original (o sólo sus cabeceras).
const ORIGINAL_START_RE =
  /Content-Type:\s*(?:message\/rfc822|text\/rfc822-headers)|-{2,}\s*The header of the original message|-{3,}\s*This is a copy of the message|-{3,}\s*Original message\s*-{3,}|-{3,}\s*Mensaje original\s*-{3,}|Original message headers:|Encabezados del mensaje original:/i;

/**
 * Del correo que el aviso devuelve, su Message-ID y su asunto. Es lo que permite colgar el rebote del
 * envío EXACTO: antes se cogía "el último envío a ese destinatario" y un rebote tardío (IONOS avisó
 * 2 h después) se colgó de una respuesta posterior que SÍ había llegado, con aviso de "No entregado"
 * incluido (03-10-2026). El Message-ID del propio aviso va en sus cabeceras de arriba, que aquí no
 * están: cualquier Message-ID del cuerpo es del original.
 */
export function returnedOriginal(rawBody: string): ReturnedOriginal {
  const body = rawBody || "";
  const at = body.search(ORIGINAL_START_RE);
  const part = (at >= 0 ? body.slice(at) : body).slice(0, 60000).replace(/\r?\n[ \t]+/g, " ");
  // Si va en quoted-printable, una cabecera larga llega partida con "=" al final: segunda pasada unida.
  const variants = [part, part.replace(/=\r?\n/g, "")];
  let message_id = "";
  let subject = "";
  for (const v of variants) {
    const mid = v.match(/^Message-ID:[ \t]*(<[^<>\s]+>|[^\s<>]+@[^\s<>]+)/im);
    if (mid && !message_id) message_id = mid[1].startsWith("<") ? mid[1] : `<${mid[1]}>`;
    const subj = v.match(/^Subject:[ \t]*(.*)$/im);
    if (subj && !subject) subject = subj[1].trim().slice(0, 300);
    if (message_id && subject) break;
  }
  return { message_id, subject };
}

const B_RECIPIENT_GONE =
  /5\.1\.[0-6]\b|5\.1\.10\b|recipient ?not ?found|unrouteable address|no such domain|domain (name )?not found|host (or domain name )?not found|nxdomain|user unknown|unknown user|no such user|no such recipient|does not exist|doesn'?t exist|recipient (address )?(not found|unknown)|invalid recipient|mailbox (unavailable|not found|does not exist)|address (unknown|not found)|no mailbox here|destinatario (desconocido|no existe|inexistente)|usuario desconocido|cuenta (inexistente|no existe)|account (has been )?(disabled|deleted|closed|inactive)/i;
const B_POLICY =
  /5\.7\.\d|spam|policy|blocked|black\s*list|block\s*list|reputation|greylist|rate limit|too many|content rejected|virus|dmarc|spf|dkim|quota|mailbox full|too large|size limit|access denied|not authorized|relay access/i;
const B_SUBJECT =
  /^\s*(?:undeliverable|undelivered mail|delivery status notification|returned mail|mail delivery (?:failed|failure|subsystem)|failure notice|delivery (?:has )?failed|delivery incomplete|message not delivered|no se (?:pudo|puede|ha podido) entregar|correo no entregado|mensaje no entregado|no entregado|non remis|unzustellbar|mancata consegna|mensagem n[aã]o entregue)/i;

/** ¿Es un aviso de entrega fallida? Devuelve su ficha, o null si es un correo normal. */
export function bounceInfo(fromEmail: string, subject: string, contentType: string, rawBody: string, xFailedRecipients = ""): BounceInfo | null {
  const from = (fromEmail || "").toLowerCase();
  const body = rawBody || "";
  const daemon = /^(mailer-daemon|postmaster)@/.test(from) || /mail.*daemon/.test(from) || /^microsoftexchange[0-9a-f]{16,}@/.test(from);
  // multipart/report también es el acuse de LECTURA (disposition-notification): ése no es un rebote.
  const report = (/multipart\/report/i.test(contentType || "") && /delivery-status/i.test(contentType || "")) || /Content-Type:\s*message\/delivery-status/i.test(body);
  const subjBounce = B_SUBJECT.test(subject || "");
  const bodyDsn = /Diagnostic-Code:|Final-Recipient:|This is the mail system at host|delivery to the following recipients?|could not be delivered|wasn'?t delivered to|couldn'?t be delivered|no se pudo entregar|no se ha podido entregar/i.test(body);
  const failedHeader = (xFailedRecipients || "").trim();
  if (!(report || failedHeader || (daemon && (subjBounce || bodyDsn)) || (subjBounce && bodyDsn))) return null;

  // Sólo se juzga lo que escribe el servidor que rebota. Debajo va la copia de NUESTRO correo
  // (con sus cabeceras DKIM/SPF y su texto): si se leyera, una palabra nuestra decidiría la clase.
  // Los avisos suelen venir en quoted-printable: una línea larga llega partida con "=" al final
  // ("blocked using S=" / "pamhaus"). Se vuelve a unir antes de leerla.
  let notice = body.split(/Content-Type:\s*(?:message\/rfc822|text\/rfc822-headers)|-{2,}\s*The header of the original message|-{3,}\s*This is a copy of the message|-{3,}\s*Original message\s*-{3,}|-{3,}\s*Mensaje original\s*-{3,}/i)[0]
    .replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/g, (_, h) => { const c = parseInt(h, 16); return c >= 32 && c < 127 ? String.fromCharCode(c) : " "; });
  // Si la explicación viene en base64 (pasa cuando el servidor remoto contesta con tildes), se
  // decodifica: sin esto sólo se veía "Action: failed" y el rebote quedaba sin motivo.
  notice = notice.replace(/(?:^|\n)((?:[A-Za-z0-9+/]{60,}\r?\n)+[A-Za-z0-9+/]*={0,2})(?=\r?\n|$)/g, (whole, b64: string) => {
    try {
      const text = atob(b64.replace(/\s+/g, ""));
      const printable = text.replace(/[^\x20-\x7E\r\n\t]/g, "").length;
      return printable > text.length * 0.85 ? "\n" + text.replace(/[^\x20-\x7E\r\n\t]/g, " ") : whole;
    } catch { return whole; }
  });
  // La explicación en claro: "reason: 550 5.4.1 Recipient address rejected: Access denied" (IONOS,
  // partida en varias líneas de 76 caracteres), el Diagnostic-Code del estándar o la línea que
  // sigue a la dirección que falló.
  const explain = (
    notice.match(/reason:\s*([^\n]{3,300}(?:\r?\n[ \t]+[^\s][^\n]{0,300}){0,4})/i)?.[1]
    || notice.match(/Diagnostic-Code:\s*([^\n]+(?:\n[ \t]+[^\n]+)*)/i)?.[1]
    || notice.match(/(?:address(?:\(es\))?\s+failed|could not be delivered[^\n]*|no se pudo entregar[^\n]*)[:\s]*\n+\s*<?\S+@\S+>?:?[ \t]*\n?\s*([^\n]{5,300})/i)?.[1]
    || notice.match(/^[^\n]*\b[45][0-9]{2}[ -][^\n]{4,300}/im)?.[0]
    || ""
  ).replace(/\s+/g, " ").trim();
  const diagLines: string[] = [
    ...(notice.match(/^(?:Status|Diagnostic-Code|Action|Remote-MTA):[^\n]*/gim) || []),
    ...(notice.match(/^[^\n]*\b[45][0-9]{2}[ -][^\n]*/gim) || []).slice(0, 6),
    ...(explain ? [explain] : []),
  ];
  const diag = diagLines.join("\n");
  const status = diag.match(/Status:\s*([245]\.\d+\.\d+)/i)?.[1] || diag.match(/\b([45]\.\d+\.\d+)\b/)?.[1] || "";
  const smtp = diag.match(/\b([45][0-9]{2})[ -]/)?.[1] || "";
  const code = status || smtp;
  const failedAction = /^Action:\s*failed/im.test(diag);
  const delayed = !failedAction && (/^Action:\s*delayed/im.test(diag) || /^4/.test(code) || /delayed|retras|still being retried|se seguir[aá] intentando/i.test(subject || ""));
  const permanent = !delayed;
  const cls: BounceClass = delayed ? "temporary"
    : (B_RECIPIENT_GONE.test(diag) && !B_POLICY.test(diag)) ? "recipient_gone"
    : B_POLICY.test(diag) ? "policy" : "other";

  const emails = new Set<string>();
  const push = (e?: string | null) => {
    const v = (e || "").trim().toLowerCase().replace(/^<|>$/g, "");
    if (/^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$/.test(v) && !isAutomatedSender(v)) emails.add(v);
  };
  for (const m of body.matchAll(/(?:Final|Original)-Recipient:\s*(?:rfc822;)?\s*<?([^\s<>;]+@[^\s<>;]+)>?/gi)) push(m[1]);
  for (const m of body.matchAll(/X-Failed-Recipients:\s*<?([^\s<>;,]+@[^\s<>;,]+)>?/gi)) push(m[1]);
  for (const e of failedHeader.split(/[,\s]+/)) push(e);
  // Avisos sin campos DSN (Exchange, Gmail): la dirección va en la frase que explica el fallo.
  if (emails.size === 0) {
    // IONOS / Exim: "The following address(es) failed:" y la dirección en la línea de debajo.
    const ex = notice.match(/failed:\s*\n+\s*<?([^\s<>:;,]+@[^\s<>:;,]+)>?:?/i);
    if (ex) push(ex[1]);
  }
  if (emails.size === 0) {
    const m = body.slice(0, 4000).match(/(?:delivered to|deliver(?:y)? to|message to|mensaje (?:a|para)|recipients?|destinatarios?|entregar a|address)[^@\n]{0,80}?<?([^\s<>;,()"]+@[^\s<>;,()"]+\.[a-z]{2,})>?/i);
    if (m) push(m[1]);
  }
  // Sin explicación reconocible se guarda el principio del aviso tal cual: mejor texto en bruto
  // que un rebote sin motivo.
  const rawNotice = notice.replace(/^(?:--[^\n]*|Content-[A-Za-z-]+:[^\n]*|MIME-Version:[^\n]*|This is a (?:MIME|multi)[^\n]*)$/gim, "").replace(/\s+/g, " ").trim();
  const firstDiag = (explain || diagLines.find((l) => !/^(Action|Status|Remote-MTA):/i.test(l)) || rawNotice || diagLines[0] || "").replace(/\s+/g, " ").trim().slice(0, 300);
  return { recipients: Array.from(emails), code, cls, permanent, diag: firstDiag, original: returnedOriginal(body) };
}
