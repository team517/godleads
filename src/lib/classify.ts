// Pure, dependency-free intent classifier for inbox replies. NO AI — fast, free,
// deterministic, so it can run on every message without cost. The rules below are the
// SINGLE source of truth (Unibox delegates to this after cleaning the body text).
//
// Categories drive the Unibox filter pills + the daily digest:
//   interested / question / not_interested / out_of_office / neutral
//
// Priority (first match wins, top = strongest override):
//   1. bounce / "person no longer here" / auto-reply / out-of-office  → out_of_office
//   2. clear NOT interested (unless they also ask for info/a call)     → not_interested
//   3. clear interest / meeting / "send me info" / a proposed time     → interested
//   4. a genuine question / doubt                                      → question
//   5. everything else                                                 → neutral

export type MessageCategory =
  | "interested"
  | "not_interested"
  | "question"
  | "out_of_office"
  | "neutral";

/** Light normalization — strip any leftover tags/entities, collapse spaces, lowercase.
 *  The Unibox already decodes base64/MIME/quoted-printable before calling this, but we
 *  stay robust in case raw text arrives (e.g. the unit tests). */
function prep(s: string | null): string {
  return (s || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/https?:\/\/\S+/gi, " ")   // URLs shouldn't feed word/"?" matching
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

const any = (patterns: RegExp[], text: string) => patterns.some((p) => p.test(text));

// ── 1) Bounce / left-the-company / auto-reply / out-of-office ───────────────
// These are NOT leads. Kept first so a "no longer here / I'm on holiday" mail can
// never be mistaken for interest.
const SYSTEM_BOUNCE = [
  /mailer[- ]?daemon/i, /postmaster/i, /\bundeliverable\b/i, /delivery (has )?failed/i,
  /could not be delivered/i, /message not delivered/i, /address not found/i,
  /no such (user|address|mailbox)/i, /quota exceeded/i, /recipient.*(rejected|not found)/i,
];
const LEFT_COMPANY = [
  /no longer (available|with|employ|work|here|at|part of|the correct)/i,
  /(email|e-mail|mail)?\s*(address|adress|adresse)?\s*is no longer/i,
  /has left (the )?(company|organi|business)/i,
  /(ya )?no (trabaja|est[áa]|pertenece|forma parte|se encuentra)/i,
  /n['e ]est plus (disponible|dans|en poste|chez|l[ae])/i,
  /non (è|e) pi[uù] (disponibile|in azienda|presente)/i,
  /nicht mehr (verf[üu]gbar|bei|besch[äa]ftigt)/i,
  /please (contact|reach).*(my|the) (new|colleague|replacement|successor)/i,
  /nueva direcci[óo]n de correo/i, /new (email|e-mail) address/i,
];
const OUT_OF_OFFICE = [
  /out of (the )?office/i, /\booo\b/i, /auto(matic|mated)?[- ]?(reply|response|responder)/i,
  /automatische antwort/i, /r[ée]ponse automatique/i, /risposta automatica/i, /respuesta autom[áa]tica/i,
  /fuera de (la )?oficina/i, /estar[ée]?\s+(fuera|ausente|de vacaciones|out)/i, /estoy (fuera|ausente|de vacaciones)/i,
  /de vacaciones/i, /\bvacation(s)?\b/i, /vacacion/i, /on (annual |sick |parental )?(leave|holiday|vacation|pto)/i,
  /away (from|until|on)/i, /currently (out|away|unavailable|on)/i,
  /(i'?m|am|is|are|will be|currently|remain)\s+unavailable/i, /unavailable (until|from|till|on|during|this)/i,
  /will be (out|away|back|unavailable)/i, /(back|return(ing)?) (on|from|the)/i,
  /de retour le/i, /en cong[ée]/i, /absent[e]? du bureau/i, /\babsence\b/i,
  /fuori sede/i, /in ferie/i, /\bassent[ei]\b/i, /assenza/i,
  /abwesen(d|heit)/i, /nicht im b[üu]ro/i,
  /vuelvo el/i, /regreso el/i, /volver[ée] el/i, /back in the office/i,
  /(estoy|estar[ée]?|est[áa]|estamos|estaremos)\s+de\s+baja\b/i, /\bde\s+baja\s+(m[ée]dica|laboral|por|maternal|paternal)/i, /baja\s+(m[ée]dica|laboral)/i,
];

// ── 2) NOT interested ───────────────────────────────────────────────────────
// Someone asking for info / a call is NOT "not interested" even if they wrote "no".
const SEND_INFO = /(p[áa]s|env[íi]|mand|send|shar|remit)\w*\s+(me\s+|nos\s+|us\s+)?(la\s+|el\s+|los\s+|the\s+|some\s+|m[áa]s\s+)*(info|informaci[óo]n|detalle|details|dato|propuesta|presupuesto|proposal|pricing|quote|precio|price|demo|cotizaci[óo]n)/i;
const ENGAGEMENT = [
  SEND_INFO,
  /(cu[ée]nta|tell)(me|nos|\s+me|\s+us)?\s*(m[áa]s|more|about)/i,
  /(quiero|queremos|me gustar[íi]a|nos gustar[íi]a|i'?d like|we'?d like)\s*(saber|conocer|ver|una demo|a demo|more|m[áa]s)/i,
  /(podemos|podr[íi]amos|can we|could we|let'?s)\s*(hablar|vernos|reunir|quedar|talk|meet|chat|connect|call)/i,
  // NOTE: do NOT put a bare "interested" here — "not interested" contains it and would
  // wrongly flip a clear rejection into engagement.
];
const NOT_INTERESTED = [
  /no\s+(me|nos)\s+interesa/i, /no\s+est(oy|amos)\s+interesad/i, /sin\s+inter[ée]s/i,
  /\bnot\s+interested\b/i, /\bno\s+interest\b/i, /pas\s+int[ée]ress[ée]/i, /kein\s+interesse/i, /non\s+(mi|ci)\s+interessa/i,
  /no\s+ens\s+interessa/i,
  /(no|not).{0,15}(a\s+)?(fit|good fit|match|lo que (buscamos|necesitamos))/i,
  /ya\s+(tenemos|contamos con|trabajamos con|disponemos)/i, /already\s+(have|work with|use|using|got)/i,
  /(we'?re|estamos|estoy)\s+(all set|cubiertos|servidos)/i,
  /(no,?\s*)?(gracias|thanks|thank you)[.! ]*$/i, /no\s+thank/i,
  /unsubscri/i, /desuscri/i, /darse de baja/i, /d[ée]sinscri/i, /darme de baja/i,
  /(please\s+)?remove\s+(me|us)?\s*(from|de)/i, /quit(ar|en|a)?\s+(me\s+|nos\s+)?de\s+(la\s+)?lista/i,
  /d[aá](r|me|te|nos|rme|rte)?\s*de\s*baja/i,
  /take\s+(me|us)?\s*off/i, /stop\s+(contact|email|writ|send)/i,
  /(no|don'?t|do not)\s+(me\s+)?(contact|email|write|escrib|contacte|env[íi]e)/i,
  /deja\s+de\s+(enviar|escribir|contactar|molestar)/i, /leave me alone/i,
  /no\s+(nos\s+)?(interesa|hace falta|necesitamos)/i,
];

// ── 3) Interested ───────────────────────────────────────────────────────────
const INTERESTED = [
  /me\s+interesa/i, /nos\s+interesa/i, /est(oy|amos)\s+interesad/i, /\binteresad[oa]s?\b/i,
  /(i'?m|we'?re)\s+interested/i, /\binterested\b/i, /interess(a|ato|ati|ante)/i, /suona interessante/i, /sembra interessante/i,
  /(me\s+)?parece\s+(interesante|bien|genial)/i, /suena\s+(bien|interesante|genial)/i, /sounds\s+(good|great|interesting)/i,
  /(let'?s|vamos a|podemos)\s+(talk|chat|connect|meet|hablar|vernos|reunir|quedar|agendar)/i,
  /hablemos/i, /me gustar[íi]a (hablar|saber|conocer|una|ver una)/i,
  /agend(a|ar|amos|emos|é)/i, /\breuni[óo]n\b/i, /\bmeeting\b/i, /schedule (a )?(call|meeting|time)/i,
  /(book|set up|reserva|reservar)\s+(a\s+|un[a]?\s+)?(call|time|slot|meeting|hueco|llamada|cita|demo)/i,
  /\bcalendly\b/i, /\bcalendar\b/i,
  /(when|cu[áa]ndo)\s+(are you|est[áa]s|est[áa]is|puedes|podemos|would you|te viene)/i,
  /disponib(le|ilidad)/i, /\bavailab(le|ility)\b/i, /estoy disponible/i, /(i'?m|we'?re)\s+available/i,
  /(a|sobre) las \d{1,2}([:.]\d{2})?/i, /\b\d{1,2}\s*(h|hrs|am|pm)\b/i, /\b(lunes|martes|mi[ée]rcoles|jueves|viernes|monday|tuesday|wednesday|thursday|friday)\b.*\b\d/i,
  SEND_INFO,
  /(quiero|queremos|me gustar[íi]a)\s+(una demo|probar|ver[l]?o|conocer)/i,
  /(s[íi]|yes)[,! ]+(claro|por supuesto|encantad|adelante|please|sure|absolutely|of course|me interesa|hablamos)/i,
  /(adelante|dale|perfecto,?\s*hablamos|vamos adelante|go ahead|let'?s do it)/i,
];

// ── 4) Question / doubt ─────────────────────────────────────────────────────
const UNCERTAIN = [
  /no\s+s[ée]\s+si\s+(me|nos|le)?\s*(interesa|conviene|sirve|aplica|encaja)/i,
  /not\s+sure\s+(if|whether|about)/i, /no\s+(lo\s+)?tengo\s+claro/i, /no\s+est(oy|amos)\s+segur/i,
  /(quiz[áa]s|tal vez|maybe|perhaps)\b/i,
];
const QUESTION = [
  /(cu[áa]nto|qu[ée]|c[óo]mo|cu[áa]l|cu[áa]ndo|d[óo]nde|por qu[ée])\s+(cuesta|vale|precio|cost|incluye|funciona|es|ser[íi]a|hac|puedo|podemos|ser|tiene)/i,
  /(how|what|which|when|where|why)\s+(much|does|is|are|can|would|about|kind|type|exactly)/i,
  /\b(pregunta|duda|consulta)\b/i, /tengo una (pregunta|duda|consulta)/i, /a\s+question/i,
  /(podr[íi]as?|podr[íi]ais|puedes|pod[ée]is|could you|can you|would you)\b/i,
  /(do|does|are|is|can)\s+you\s+(offer|have|provide|support|work|charge|include)/i,
  /me puedes? (decir|explicar|contar|mandar|enviar|dar)/i,
  /\?/,
];

export function classifyMessage(subject: string | null, body: string | null): MessageCategory {
  const subjectText = prep(subject);
  const bodyText = prep(body);
  const text = `${subjectText} ${bodyText}`.trim();
  if (text.replace(/\s+/g, "").length < 2) return "neutral"; // nothing meaningful to read

  // 1) Bounce / left the company / auto-reply / OOO — always wins.
  if (any(SYSTEM_BOUNCE, text) || any(LEFT_COMPANY, text) || any(OUT_OF_OFFICE, text)) return "out_of_office";

  const hasEngagement = any(ENGAGEMENT, text);

  // 2) Clearly not interested (unless they still asked for info / a call).
  if (!hasEngagement && any(NOT_INTERESTED, text)) return "not_interested";

  // Doubt about fit reads as a question even if they also ask for info.
  if (any(UNCERTAIN, text)) return "question";

  // 3) Interested (positive buying signals).
  if (any(INTERESTED, text)) return "interested";

  // Asked for info / a call (without doubt or a rejection) → that's a warm lead.
  if (hasEngagement) return "interested";

  // 4) A genuine question.
  if (any(QUESTION, text)) return "question";

  return "neutral";
}
