// Pure, dependency-free intent classifier for inbox replies. NO AI — fast, free,
// deterministic, so it can run on every message without cost. The rules below are the
// SINGLE source of truth (Unibox delegates to this after cleaning the body text).
//
// Categories drive the Unibox filter pills + the daily digest:
//   interested / question / not_interested / no_contactar / derivado / out_of_office / neutral
//
// Priority (first match wins, top = strongest override):
//   1. bounce / "person no longer here" / auto-reply / out-of-office  → out_of_office (AUTOMÁTICO)
//   2. unsubscribe / RGPD / spam / hostile — "la baja manda"          → no_contactar
//   3. hands you off to another person ("esto lo lleva Marta")        → derivado
//   4. clear NOT interested (unless they also ask for info/a call)    → not_interested
//   5. clear interest / meeting / "send me info" / a proposed time    → interested
//   6. a genuine question / doubt                                     → question
//   7. everything else                                                → neutral

export type MessageCategory =
  | "interested"
  | "not_interested"
  | "no_contactar"
  | "derivado"
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
  // Extra absence / inactive-account / auto-reply signals seen in real August traffic
  // (multilingual): "no será leído hasta", "Ausencia", inactive/deactivated mailboxes,
  // Catalan "fora de l'oficina", French "serai absent", English "summer break", and the
  // "Auto:" subject prefix some mail clients put on their auto-replies.
  /no\s+ser[áa]\s+le[íi]d[oa]\s+hasta/i, /\bausencia\b/i,
  /(correo|cuenta|email|compte|bústia|casella)\s+(electr[óo]nic[oa]\s+)?(se\s+encuentra\s+|est[àa]\s+)?inactiv[oau]?/i,
  /(deixar[àa]|dejar[áa])\s+d[e']?\s*(estar\s+)?actiu?/i,
  /fora de l['i ]?oficina/i,
  /(je\s+)?serai\s+absent/i,
  /summer\s+(break|holidays?|closure|vacation)/i, /closed\s+for\s+(summer|the\s+holidays|vacation)/i,
  /(^|\s)auto\s*:\s*(re|rv|fw|aw)\b/i,
];

// ── 2) NOT interested ───────────────────────────────────────────────────────
// Someone asking for info / a call is NOT "not interested" even if they wrote "no".
const SEND_INFO = /(p[áa]s|env[íi]|mand|send|shar|remit)\w*\s+(me\s+|nos\s+|us\s+)?(la\s+|el\s+|los\s+|las\s+|una?\s+|the\s+|a\s+|some\s+|m[áa]s\s+)*(info|informaci[óo]n|detalle|details|dato|propuesta|presupuesto|proposal|pricing|quote|precio|price|demo|cotizaci[óo]n)/i;
const ENGAGEMENT = [
  SEND_INFO,
  /(cu[ée]nta|tell)(me|nos|\s+me|\s+us)?\s*(m[áa]s|more|about)/i,
  // "cuéntame/dime/explícame + precio/info/detalle…" — a direct request FOR INFO to me
  // (me/nos REQUIRED so a stray "el Colegio cuenta cómo…" in a newsletter never counts).
  // This is what makes "Cuéntame precios y disponibilidad" a warm lead, without the old
  // bare "disponibilidad" that flagged "servicio disponible 24/7" as interested.
  /(cu[ée]nta|d[íi]|expl[íi]ca)(me|nos)\s+(el\s+|los\s+|la\s+|las\s+|un\s+|una\s+|m[áa]s\s+|sobre\s+|acerca\s+de\s+)?(precio|coste|presupuesto|info|informaci[óo]n|detalle|disponibilidad|tarifa|cotizaci[óo]n)/i,
  /(quiero|queremos|me gustar[íi]a|nos gustar[íi]a|i'?d like|we'?d like)\s*(saber|conocer|ver|una demo|a demo|more|m[áa]s)/i,
  /(podemos|podr[íi]amos|can we|could we|let'?s)\s*(hablar|vernos|reunir|quedar|talk|meet|chat|connect|call)/i,
  // NOTE: do NOT put a bare "interested" here — "not interested" contains it and would
  // wrongly flip a clear rejection into engagement.
];
const NOT_INTERESTED = [
  // "no interesa", "no me interesa", "no interesado/a/s" (with or without me/nos/estoy),
  // "no interés", "sin interés" — the plain "No interesado" reply that used to leak as
  // Interested because the bare word "interesado" matched. NOTE: unsubscribe / "don't
  // contact me" phrasing lives in DO_NOT_CONTACT below (checked first — la baja manda).
  /\bno\s+(me\s+|nos\s+|le\s+|les\s+|estamos?\s+|est[áa]n?\s+)?interesad[oa]s?\b/i,
  /\bno\s+(me\s+|nos\s+|le\s+|les\s+)?interesa\b/i,
  /\bno\s+(hay\s+)?inter[ée]s\b/i, /sin\s+inter[ée]s/i,
  /\bnot\s+interested\b/i, /\bno\s+interest\b/i, /pas\s+int[ée]ress[ée]/i, /kein\s+interesse/i, /non\s+(mi|ci)\s+interessa/i,
  /no\s+ens\s+interessa/i,
  /(no|not).{0,15}(a\s+)?(fit|good fit|match|lo que (buscamos|necesitamos))/i,
  /ya\s+(tenemos|contamos con|trabajamos con|disponemos)/i, /already\s+(have|work with|use|using|got)/i,
  /(lo hacemos|lo llevamos|lo gestionamos|ho fem|ho gestionem|ho portem)\s+(internamente|internament|in[- ]?house|nosotros|nosaltres)/i, /\bin[- ]?house\b/i,
  // NOTE: bare "internamente" was REMOVED here — corporate legal disclaimers ("este correo
  // solo puede distribuirse internamente…") made real referrals/replies read as not_interested.
  // "lo hacemos internamente" is still caught by the contextual pattern just above.
  /(no hay|sin)\s+(presupuesto|budget)/i, /(no es el|not the right)\s+momento/i, /(ahora|now)\s+no\s+(es el momento|toca)/i, /not?\s+(right\s+)?now/i,
  /no\s+es\s+(una\s+)?prioridad/i, /not\s+a\s+priority/i, /no\s+(es\s+)?prioritari/i,
  /(we'?re|estamos|estoy)\s+(all set|cubiertos|servidos)/i,
  /(no,?\s*)?(gracias|thanks|thank you)[.! ]*$/i, /no\s+thank/i,
  /no\s+(nos\s+)?(interesa|hace falta|necesitamos|encaja)/i,
  // ── French rejections (REVIMA & other FR prospects). "pas intéressé" is covered
  // above; add the "ne … pas" forms, "we don't need", and the fit-rejection
  // "nous n'avons pas dans nos … de composants/références/produits" (= we don't deal
  // with that). These read as NOT interested, not a warm reply.
  /ne\s+(nous\s+|m['’e ]?)?int[ée]resse\s+pas/i,
  /n['’]avons\s+pas\s+besoin/i,
  /n['’]avons\s+pas\s+(dans\s+nos?|de)\b[^.?!]{0,35}\b(composant|r[ée]f[ée]rence|produit|mat[ée]riel|article|pi[èe]ce)/i,
  /(cela|[çc]a|ce)\s+ne\s+(nous\s+)?correspond\s+pas/i,
  // More real rejections seen in August traffic (multilingual): "no need thank you",
  // in-house ("hacemos/tenemos nuestro propio…"), Italian "siamo a posto / non fa per
  // noi", "no es nuestro caso / para nosotros / lo que buscamos".
  /\bno\s+need\b[^.!?]{0,18}(thank|thanks|for\s+now|right\s+now|at\s+the\s+moment|por\s+ahora)/i, /\bno\s+need,?\s*thank/i,
  /\bno\s+necesito\b/i,
  /(hacemos|tenemos|desarrollamos|fabricamos|producimos|montamos)\s+(lo\s+|el\s+|la\s+|nuestro\s+|nuestra\s+|nuestros\s+|nuestras\s+)*propi[oa]s?\b/i,
  /siamo\s+a\s+posto/i, /non\s+fa\s+per\s+noi/i,
  /no\s+es\s+(nuestro\s+caso|para\s+nosotros)/i, /no\s+es\s+lo\s+que\s+(buscamos|necesitamos|nos\s+interesa)/i,
];

// ── 2b) DO NOT CONTACT — unsubscribe / RGPD / spam / hostile. "La baja manda":
// checked BEFORE not-interested and NEVER saved by an accompanying question/engagement.
const DO_NOT_CONTACT = [
  /unsubscri/i, /desuscri/i, /d[ée]sinscri/i,
  /d[aá]d?(me|nos)?\s+de\s+baja/i, /d[aá](r|rme|rnos)?\s+de\s+baja/i, /me\s+doy\s+de\s+baja/i, /darse de baja/i,
  /(quiero|queremos|solicito|solicitamos|desea\w*|pido|pedimos)\s+(la\s+|una\s+|darme\s+de\s+|darnos\s+de\s+)?baja/i,
  /baja\s+de\s+(la\s+)?lista/i, /\bbaja\b.*lista/i,
  /(please\s+)?remove\s+(me|us)?\s*(from|de)/i, /quit(a|ad|en|adme|arme|ame|adnos)?\s+(me\s+|nos\s+)?de\s+(la\s+)?lista/i, /b[óo]rr(a|ame|enme|adme|ad|arme)\s*(me\s+)?(de\s+(la\s+)?lista|mis datos)?/i,
  /take\s+(me|us)?\s*off/i,
  /stop\s+(contact|email|writ|send|messag|reach)/i,
  /(no|don'?t|do not)\s+(me\s+|nos\s+)?(contact|email|write|escrib|contacte|env[íi]e|manden?|mand[ée]is)/i,
  /deja(d|r)?\s+de\s+(enviar|escribir|contactar|molestar|mandar)/i,
  /no\s+(me\s+|nos\s+)?(volv[áa]is|vuelvas?|volver)\s+a\s+(escribir|contactar|enviar|molestar|mandar)/i,
  /no\s+(me\s+|nos\s+)?(escrib[áa]is|escribas|contact[ée]is|mand[ée]is)\s+(m[áa]s|nunca m[áa]s)?/i,
  /leave me alone/i, /d[ée]jad?me en paz/i,
  // RGPD / data protection
  /\brgpd\b/i, /\bgdpr\b/i, /\blopd\b/i, /protecci[óo]n de datos/i, /data protection/i, /datos personales/i,
  // spam accusation
  /\bspam\b/i, /correo (no deseado|basura)/i, /junk mail/i, /unsolicited/i,
];

// ── 2c) DERIVADO — hands you off to another person/team. Conservative patterns so a
// plain "contáctanos" (themselves) doesn't count. Checked after DO_NOT_CONTACT.
const REFERRAL = [
  /(esto|eso|este (tema|asunto|correo)|el tema)\s+(lo|la)\s+(lleva|gestiona|ve\b|maneja|coordina|gestion)/i,
  /(la persona|el|la)\s+(encargad[oa]|responsable|indicad[oa]|adecuad[oa])\s+(es|ser[íi]a|de esto)/i,
  /te\s+(paso|pongo|dejo|reenv[íi]o|derivo)\s+(con|a|el|la|los|su|tu|el correo)/i,
  /no\s+soy\s+(yo|la persona|el|la)\s+(indicad|adecuad|correct|encargad|responsable|qui[ée]n)/i,
  /(deber[íi]as|mejor|te recomiendo)\s+(hablar|contactar|escribir|dirigirte)\s+(con|a)\b/i,
  /(habla|contacta|escribe|dir[íi]gete)\s+(con|a)\s+(?!nosotros|nuestr|m[íi]\b|conmigo|el equipo\b)/i,
  /reach out to\s+/i, /you (should|can|may want to)\s+(contact|reach|talk to|speak with)\s+/i,
  /(is|es)\s+the\s+(right|best)\s+person/i, /(qui[ée]n|who)\s+(lo\s+)?(lleva|gestiona|se encarga|handles)/i,
  /(competencia|responsabilidad|cosa)\s+de\s+\w+/i, /(reenv[íi]|forward)\w*\s+(tu|este|esta|su|el|la|los|las|your|to)/i,
  // "He reenviado tu correo al área de compras / al departamento / al responsable" — a
  // referral to the right team, NOT a rejection (the disclaimer word "internamente" used
  // to leak these to not_interested).
  /reenvi\w+[^.?!]{0,30}\b(compras|departament\w*|[áa]rea|responsable|direcci[óo]n|equipo)\b/i,
  // "No decido nada" / "no soy quien decide" — not the decision-maker → redirect, not a no.
  /\bno\s+decido\b/i, /no\s+soy\s+qui[ée]n\s+(decide|lo\s+decide)/i, /no\s+(soy\s+el\s+que\s+)?tom[oa]\s+(la|las|esa|estas)\s+decisi/i,
];

// ── 3) Interested ───────────────────────────────────────────────────────────
const INTERESTED = [
  /me\s+interesa/i, /nos\s+interesa/i, /est(oy|amos)\s+interesad/i, /\binteresad[oa]s?\b/i,
  /(i'?m|we'?re)\s+interested/i, /\binterested\b/i, /interess(a|ato|ati|ante)/i, /suona interessante/i, /sembra interessante/i,
  /(me\s+)?parece\s+(interesante|bien|genial)/i, /suena\s+(bien|interesante|genial)/i, /sounds\s+(good|great|interesting)/i,
  /(let'?s|vamos a|podemos)\s+(talk|chat|connect|meet|hablar|vernos|reunir|quedar|agendar)/i,
  /hablemos/i, /me gustar[íi]a (hablar|saber|conocer|una|ver una)/i,
  /agend(a|ar|amos|emos|é)/i, /\breuni[óo]n\b/i, /\bmeeting\b/i, /schedule (a )?(call|meeting|time)/i,
  /(book|set up|schedule|reserv\w+|agend\w+|apunt\w+|organic\w+|concert\w+)\b[^.?!]{0,25}(call|time|slot|meeting|demo|llamada|reuni[óo]n|cita|hueco|chat)/i,
  /(me|nos)\s+encaja/i, /(me|nos)\s+(viene|va)\s+(bien|genial|perfecto)/i,
  /\bcalendly\b/i, /\bcalendar\b/i,
  /(when|cu[áa]ndo)\s+(are you|est[áa]s|est[áa]is|puedes|podemos|would you|te viene)/i,
  // A prospect stating THEIR OWN availability to meet = interest. The bare
  // "disponible"/"available" was REMOVED: it matched "servicio disponible 24/7",
  // "producto no disponible", "horario disponible"… (a THING being available, not the
  // person) → false "Interesado" (real case: a Colegio de Aparejadores newsletter).
  // "¿cuándo estás disponible?" is still caught by the when/cuándo meeting pattern below.
  /est(oy|amos)\s+disponibl\w*/i, /(i'?m|we'?re)\s+available\b/i, /(mi|nuestra)\s+disponibilidad\b/i,
  // "¿Tenéis hueco el jueves?" — asking for a slot/time to meet = a warm meeting ask.
  /\bhueco\b/i, /(ten[ée]is|tienes|ten[ée]s|hay|te va bien|os va bien|te viene|os viene|te encaja)\b[^.?!]{0,25}(hueco|disponib|un (rato|momento|hueco)|libre|para (hablar|vernos|una (llamada|reuni)))/i,
  // A proposed time ONLY counts as interest when it sits next to a meeting word. A bare
  // "a las 10:00" / "el jueves 20" / "10h" is NOT interest — it shows up in timestamps,
  // signatures and out-of-office notes, which used to leak as false "Interesado".
  /(reuni[óo]n|llamada|call|meeting|demo|cita|vernos|quedar|hablar)\b[^.?!]{0,30}\b((a|sobre) las \d{1,2}|\d{1,2}\s*(h|hrs|am|pm)\b|(lunes|martes|mi[ée]rcoles|jueves|viernes|monday|tuesday|wednesday|thursday|friday))/i,
  /((a|sobre) las \d{1,2}|\d{1,2}\s*(h|hrs|am|pm)\b|(lunes|martes|mi[ée]rcoles|jueves|viernes))\b[^.?!]{0,30}(reuni[óo]n|llamada|call|meeting|demo|cita|vernos|quedar|hablar|me (viene|va) bien|te (viene|va) bien|perfecto)/i,
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

  // 2) Unsubscribe / RGPD / spam / hostile — "la baja manda": beats rejection AND is
  // NOT saved by an accompanying question or engagement (they want it to STOP).
  if (any(DO_NOT_CONTACT, text)) return "no_contactar";

  // 2b) Hands you off to someone else ("esto lo lleva Marta") — a redirect, not a no.
  if (any(REFERRAL, text)) return "derivado";

  const hasEngagement = any(ENGAGEMENT, text);

  // 3) Clearly not interested (unless they still asked for info / a call).
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
