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
