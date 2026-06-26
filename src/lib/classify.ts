// Pure, dependency-free intent classifier for inbox replies.
// Categories drive the Unibox filter pills: Interesado / Pregunta / No interesado /
// Fuera-Auto / Neutral. Kept side-effect-free so it can be unit-tested and reused.

export type MessageCategory =
  | "interested"
  | "not_interested"
  | "question"
  | "out_of_office"
  | "neutral";

/** Light normalization — strip tags/entities and lowercase. Enough for matching. */
function prep(s: string | null): string {
  return (s || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

export function classifyMessage(subject: string | null, body: string | null): MessageCategory {
  const subjectText = prep(subject);
  const bodyText = prep(body);
  const text = `${subjectText} ${bodyText}`;

  // Out of office / auto-reply / system bounce — checked first, overrides others.
  const oooPatterns = [
    /out of (the )?office/i, /fuera de (la )?oficina/i, /auto[- ]?reply/i,
    /respuesta autom[áa]tica/i, /vacacion/i, /vacation/i, /away from/i, /estaré ausente/i,
    /no disponible/i, /not available/i, /automatic reply/i, /delivery.*fail/i,
    /undeliverable/i, /mailer[- ]?daemon/i, /postmaster/i, /on leave/i,
    /currently out/i, /will be back/i, /vuelvo el/i, /regreso el/i,
    /ausencia/i, /congé/i, /abwesend/i,
  ];
  if (oooPatterns.some((p) => p.test(text))) return "out_of_office";

  // Engagement signals: asking for info / wanting to talk → NOT "not interested".
  const engagementPatterns = [
    /p[áa]sa(me|nos)\s+(info|informaci[óo]n|datos|m[áa]s)/i,
    /env[íi]a(me|nos)\s+(info|informaci[óo]n|datos|m[áa]s)/i,
    /manda(me|nos)\s+(info|informaci[óo]n|datos)/i,
    /send.*(info|details|more)/i,
    /tell.*more/i, /cu[ée]nta.*m[áa]s/i, /cu[ée]ntame/i, /cu[ée]ntanos/i,
    /quiero.*(info|saber|ver|conocer)/i,
    /me\s+gustar[íi]a\s+(saber|conocer|ver)/i,
    /igualmente.*(p[áa]sa|env[íi]a|manda|info)/i,
    /pero.*(p[áa]sa|env[íi]a|manda|info|cu[ée]nta)/i,
    /de\s+todas\s+(formas|maneras).*(info|saber)/i,
    /anyway.*(send|tell|info)/i,
  ];
  const hasEngagement = engagementPatterns.some((p) => p.test(text));

  // Not interested — strong, unambiguous negatives WITHOUT engagement.
  const notInterestedPatterns = [
    /no\s+me\s+interesa\b/i, /no\s+nos\s+interesa\b/i,
    /no\s+estoy\s+interesad/i, /no\s+estamos\s+interesad/i,
    /\bnot\s+interested\b/i,
    /unsubscri/i, /take.*off.*(list|lista)/i,
    /remove.*from/i, /stop.*send/i, /don'?t.*contact/i,
    /no.*thanks/i, /no.*gracias/i,
    /darse de baja/i, /desuscri/i,
    /please.*remove/i, /quitar.*de.*lista/i,
    /no ens interessa/i,
    /leave me alone/i,
    /do not (email|write|contact)/i,
    /deja\s+de\s+(enviar|escribir|contactar)/i,
    /no\s+(me\s*)?(contacte|escriba|env[íi]e)/i,
    /pas intéressé/i, /kein interesse/i,
  ];
  if (!hasEngagement && notInterestedPatterns.some((p) => p.test(text))) return "not_interested";

  // Uncertainty / doubt → Question (even if they also ask for info).
  const uncertaintyPatterns = [
    /no\s+s[ée]\s+si\s+(me\s+)?interes/i,
    /not\s+sure\s+(if|whether).*interest/i,
    /no\s+tengo\s+claro/i,
    /no\s+estoy\s+segur[oa]/i,
    /i'?m\s+not\s+sure/i,
    /no\s+s[ée]\s+si\s+(nos|me)\s+(conviene|sirve|aplica)/i,
    /quizás|quiz[áa]s|tal\s+vez|maybe|perhaps/i,
  ];
  if (uncertaintyPatterns.some((p) => p.test(text))) return "question";

  // Interested — positive buying signals.
  const interestedPatterns = [
    /let'?s.*chat/i, /schedule.*call/i, /love.*to.*hear/i,
    /\b(i'?m|we'?re|estoy|estamos)\s+interested/i, /me\s+interesa/i,
    /\binteresad[oa]\b/i, /\bestoy\s+interesad/i, /\bestamos\s+interesad/i,
    /\binterested\b/i,
    /tell.*more/i, /send.*info/i, /cu[ée]nta.*m[áa]s/i, /cu[ée]ntame/i, /cu[ée]ntanos/i,
    /hablemos/i, /agend(a|ar|emos)/i, /reuni[óo]n/i, /meeting/i, /sounds.*good/i,
    /let'?s.*connect/i, /would.*love/i, /can.*we.*talk/i,
    /podemos.*hablar/i, /disponible.*para/i, /book.*(time|slot|call)/i,
    /calendar/i, /calendly/i, /set up.*(time|call)/i,
    /me gustar[íi]a (saber|conocer)/i, /quiero.*(info|saber|ver)/i,
    /\bs[íi]\b.*\b(claro|por supuesto|encantado)\b/i,
    /\byes\b.*\b(please|sure|absolutely|definitely)\b/i,
    /send.*(proposal|quote|pricing|presupuesto|cotizaci[óo]n)/i,
    /when.*(available|free|meet)/i, /cu[áa]ndo.*(puedes|podemos)/i,
    /suena.*bien/i, /me.*parece.*bien/i, /dale/i, /perfecto/i,
    /vamos.*adelante/i, /go.*ahead/i, /let'?s.*do/i,
    /\bdisponibilidad\b/i, /\bavailab(le|ility)\b/i,
    /tengo.*disponib/i, /estoy.*disponib/i, /i'?m.*available/i,
    /a las \d/i, /sobre las \d/i, /from \d/i,
    /podr[íi]a(mos)?\s+(quedar|vernos|hablar|reunir)/i,
    /can.*meet/i, /let'?s.*meet/i, /nos vemos/i,
    /p[áa]sa(me|nos)\s+(info|informaci[óo]n|datos)/i,
    /env[íi]a(me|nos)\s+(info|informaci[óo]n|datos)/i,
  ];
  if (interestedPatterns.some((p) => p.test(text))) return "interested";

  if (hasEngagement) return "question";

  // Question — inquiry without a clear buying signal.
  const questionPatterns = [
    /\?/, /wondering/i, /could.*you/i, /can.*you/i, /how.*does/i,
    /what.*is/i, /pregunt/i, /podr[íi]as/i, /c[óo]mo\s+(funciona|es|hac)/i,
    /cu[áa]nto\s+(cuesta|vale|cost)/i, /what.*(price|cost)/i,
    /do you (offer|have|support)/i, /qu[ée].*incluye/i,
    /no\s+s[ée]\s+(si|qu[ée])/i,
    /not\s+sure\s+(if|about|whether)/i,
  ];
  if (questionPatterns.some((p) => p.test(text))) return "question";

  return "neutral";
}
