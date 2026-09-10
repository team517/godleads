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

// ── Author-only text ─────────────────────────────────────────────────────────
// Classification must read ONLY what the prospect wrote. Real false positives came from text
// that is not theirs: (1) OUR quoted outreach below "X escribió:" / "On … wrote:" / ">" lines
// ("looking forward to" → Derivado, "si ahora mismo no es una prioridad" → No interesado);
// (2) legal footers ("return the original message" → Fuera/Auto, "protección de datos /
// datos personales" → No contactar, "los interesados" → Interesado); (3) raw MIME noise.
// We cut the text at the EARLIEST quote/footer marker — but never when the marker sits at the
// very start (an auto-reply that itself begins with "Este correo no será leído…" must survive).
const QUOTE_MARKERS: RegExp[] = [
  /(^|\n)\s*>/,
  /(^|\n)[^\n]{0,80}\b(escribi[óo]|wrote|a écrit|schrieb|ha scritto|escreveu)\s*:/i,
  /-{0,}\s*\b(original message|mensaje original|message d'origine|ursprüngliche nachricht)/i,
  // The header block may arrive on ONE line ("De: Alfons Pons Enviado el: martes, 8 …") when the
  // client folds it — requiring a newline let OUR OWN pitch below it be classified as the lead's
  // words (real: Surinver, Suma Capital, Carrocerias JAZ read as Interesado).
  /\b(de|from|von)\s*:\s*[^\n]{1,160}?\s*(enviado el|enviado|sent|gesendet|date|fecha|envoyé)\s*:/i,
];
const FOOTER_MARKERS: RegExp[] = [
  /\b(aviso legal|legal notice|disclaimer|cláusula de confidencialidad)\b/i,
  /\b(este (mensaje|correo|e-?mail)|el presente (mensaje|correo)|this (e-?mail|message))\b[^.\n]{0,60}\b(confidencial|confidential|destinatari|intended|privileged|contiene|contains|may contain|puede contener)/i,
  /\b(la información contenida|the information (contained|in this))\b/i,
  /\b(si (usted )?no es el destinatario|if you (are not the intended|have received this))\b/i,
  /\b(protecci[óo]n de datos|data protection|datos personales|personal data|reglamento \(ue\)|ley org[áa]nica|rgpd|gdpr)\b[^.\n]{0,40}\b(responsable|finalidad|derechos|rights|tratamiento|processing|inform|conformidad|2016\/679|3\/2018)/i,
  /\b(informaci[óo]n b[áa]sica sobre|de conformidad con|en cumplimiento de|puede ejercer (sus|los) derechos)\b/i,
  /\b(please (notify|delete|destroy)|return the original message|notify (us|the sender) immediately)\b/i,
  // "Los datos personales … se almacenan/conservan…", "Puede acceder, rectificar o eliminar sus
  // datos", "Se conservarán mientras exista…" — the ASG-style privacy footer that dodged the
  // markers above and made a warm reply classify as No contactar from its own signature.
  /\b(los\s+)?datos\s+personales\b[^\n]{0,90}\b(se\s+(almacenan|conservan|tratan|utilizan|recaban)|almacenad|conservad|tratad|recabad)/i,
  /\bpuede[n]?\s+(acceder|rectificar|suprimir|eliminar|oponerse|limitar|ejercer|ejercitar)\b/i,
  /\bse\s+conservar[áa]n\s+(mientras|durante|el\s+tiempo)/i,
];
const MIME_NOISE = /(^|\n)\s*(--[_=]?[A-Za-z0-9_=.-]{12,}\s*(--)?|this message is in mime format[^\n]*|content-(type|transfer-encoding)\s*:[^\n]*|charset=[^\n]*)/gi;

/** Keep only the author's own text: strip MIME noise, then cut at the earliest quote or
 *  legal-footer marker (ignored when it sits in the first 15 chars). */
export function authorText(raw: string): string {
  const t = raw.replace(MIME_NOISE, '\n');
  let cut = t.length;
  for (const re of [...QUOTE_MARKERS, ...FOOTER_MARKERS]) {
    const m = re.exec(t);
    if (m && m.index >= 15 && m.index < cut) cut = m.index;
  }
  return t.slice(0, cut);
}

/** Light normalization — strip any leftover tags/entities, collapse spaces, lowercase.
 *  The Unibox already decodes base64/MIME/quoted-printable before calling this, but we
 *  stay robust in case raw text arrives (e.g. the unit tests). */
function prep(s: string | null): string {
  return authorText(s || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')   // URLs shouldn't feed word/"?" matching
    // Booking-link SIGNATURE boilerplate (MS Bookings / Calendly labels): a static link in the
    // sender's signature, never their own meeting offer. Real 'reservamos un momento para hablar'
    // is untouched (it lacks the fixed '…conmigo/with me' tail).
    .replace(/reservar\s+(un\s+)?(momento|hueco|espacio|una\s+cita|tiempo)\s+para\s+(reunirse|reunirte|reunirme|vernos|hablar|una\s+reuni[óo]n)\s+conmigo/gi, ' ')
    .replace(/reservar\s+una\s+reuni[óo]n\s+conmigo/gi, ' ')
    .replace(/\b(book|schedule|grab|find|pick)\s+(a\s+|some\s+)?(time|meeting|slot|call)\s+with\s+me\b/gi, ' ')
    .replace(/\bbook\s+time\s+to\s+meet\b/gi, ' ')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
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
  /(ya )?no (trabaja|est[áa]|pertenece|forma parte|se encuentra)\b(?!mos)/i,
  /n['e ]est plus (disponible|dans|en poste|chez|l[ae])/i,
  /non (è|e) pi[uù] (disponibile|in azienda|presente)/i,
  /nicht mehr (verf[üu]gbar|bei|besch[äa]ftigt)/i,
  /please (contact|reach).*(my|the) (new|colleague|replacement|successor)/i,
  /nueva direcci[óo]n de correo/i, /new (email|e-mail) address/i,
  /(cuenta|direcci[óo]n|buz[óo]n)\s+(de\s+correo\s+)?[^\n]{0,80}?(dejar[áa]|deja|dejar[áa]n)\s+de\s+(estar\s+)?(operativ|activ|funcionar)/i, /ya\s+no\s+est[áa]\s+operativ/i, /\bemail domain change\b/i,
];
const OUT_OF_OFFICE = [
  /out of (the )?office/i, /\booo\b/i, /auto(matic|mated)?[- ]?(reply|response|responder)/i,
  /automatische antwort/i, /r[ée]ponse automatique/i, /risposta automatica/i, /respuesta autom[áa]tica/i,
  /fuera de (la )?oficina/i, /estar[ée]?\s+(fuera|ausente|de vacaciones|out)/i, /estoy (fuera|ausente|de vacaciones)/i, /\bno\s+est(oy|amos|ar[ée]|ar[íi]a)\s+disponibl\w*/i,
  /de vacaciones/i, /\bvacation(s)?\b/i, /vacacion/i, /on (annual |sick |parental )?(leave|holiday|vacation|pto)/i,
  /away (from|until|on)/i, /currently (out|away|unavailable)\b/i,
  /currently on (leave|holiday|vacation|annual|maternity|paternity|sick|parental|pto|a business trip)/i,
  /(i'?m|am|is|are|will be|currently|remain)\s+unavailable/i, /unavailable (until|from|till|on|during|this)/i,
  /will be (out|away|back|unavailable)/i,
  // "back/returning on Monday / from the 5th" — a DATE must follow, else "return on investment"
  // and "get back the report" flagged real replies as out-of-office.
  /\b(back|returning|will return|be back)\s+(on|from)\s+(mon|tue|wed|thu|fri|sat|sun|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\d|next\b|the\s+\d)/i,
  /de retour le/i, /en cong[ée]/i, /absent[e]? du bureau/i, /\babsence\b(?!\s+of\b)/i,
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
const SEND_INFO = /(p[áa]s|env[íi]|m[áa]nd|send|shar|remit)\w*\s+(me\s+|nos\s+|us\s+)?(la\s+|el\s+|los\s+|las\s+|una?\s+|the\s+|a\s+|some\s+|m[áa]s\s+|more\s+)*(info|informaci[óo]n|detalle|details|dato|propuesta|presupuesto|proposal|pricing|quote|precio|price|demo|cotizaci[óo]n)/i;
const ENGAGEMENT = [
  SEND_INFO,
  // The prospect PROPOSES a meeting/slot — "si quieres reservo un rato", "¿te va bien mañana
  // sobre los 9 am?". A soft rejection followed by an offer to meet ("estamos cubiertos, no
  // obstante si quieres reservo un rato…") is a warm lead, not a no: someone offering you a
  // time slot wants the meeting. ENGAGEMENT is checked before NOT_INTERESTED, so these win.
  /reserv\w+\b[^.?!]{0,30}\b(un\s+)?(rat[oi]to|rato|hueco|momento|slot|espacio|reuni[óo]n|llamada|cita)/i,
  /(te|os|le|les|me|nos)\s+va\s+bien\b[^.?!]{0,40}\b(ma[ñn]ana|hoy|pasado\s+ma[ñn]ana|el\s+(lunes|martes|mi[eé]rcoles|jueves|viernes)|l[ao]s\s+\d{1,2}|\d{1,2}\s*(:\d{2})?\s*(am|pm|h|hs|hrs)\b)/i,
  /\b(ma[ñn]ana|tomorrow)\b[^.?!]{0,40}\b(sobre|a|about|at|around)\s+l[ao]s\s*\d{1,2}\b/i,
  // "happy to schedule a call", "let's see a demo", "send across the invite" — direct asks to move
  // forward. Listed as ENGAGEMENT so a stray rejection-looking word elsewhere can't win.
  /\bhappy\s+to\s+(schedule|talk|chat|meet|discuss|jump\s+on|connect|hop\s+on)/i,
  /\b(let'?s|lets|sure|yes|ok|okay|great)[,!\s-]+(see|do|have|book|schedule|set\s+up|arrange)\s+(a\s+|the\s+)?(demo|call|meeting)/i,
  /\b(see|do|have|book|schedule|set\s+up|arrange)\s+(a\s+|the\s+)?demo\b/i,
  /\b(send|share|forward)\s+(me\s+|us\s+|across\s+|over\s+)?(the\s+|an?\s+)?(invite|invitation|calendar\s+invite|meeting\s+link|link\s+to\s+the\s+(call|meeting))/i,
  /(cu[ée]nta|tell)(me|nos|\s+me|\s+us)?\s*(m[áa]s|more|about)/i,
  // "cuéntame/dime/explícame + precio/info/detalle…" — a direct request FOR INFO to me
  // (me/nos REQUIRED so a stray "el Colegio cuenta cómo…" in a newsletter never counts).
  // This is what makes "Cuéntame precios y disponibilidad" a warm lead, without the old
  // bare "disponibilidad" that flagged "servicio disponible 24/7" as interested.
  /(cu[ée]nta|d[íi]|expl[íi]ca)(me|nos)\s+(el\s+|los\s+|la\s+|las\s+|un\s+|una\s+|m[áa]s\s+|sobre\s+|acerca\s+de\s+)?(precio|coste|presupuesto|info|informaci[óo]n|detalle|disponibilidad|tarifa|cotizaci[óo]n)/i,
  /(quiero|queremos|me gustar[íi]a|nos gustar[íi]a|i'?d like|we'?d like)\s*(saber|conocer|ver|una demo|a demo|more|m[áa]s)/i,
  /(podemos|podr[íi]amos|can we|could we|let'?s)\s*(hablar|vernos|reunir|quedar|talk|meet|chat|connect|call)/i,
  // French "envoyez-moi / envoie-nous …" = asking us to send them something → a warm request.
  // ("ne m'envoyez plus …" stays a no because DO_NOT_CONTACT is checked first.)
  /envoy\w*[-\s]?(moi|nous)\b/i,
  // NOTE: do NOT put a bare "interested" here — "not interested" contains it and would
  // wrongly flip a clear rejection into engagement.
];
const NOT_INTERESTED = [
  // "no interesa", "no me interesa", "no interesado/a/s" (with or without me/nos/estoy),
  // "no interés", "sin interés" — the plain "No interesado" reply that used to leak as
  // Interested because the bare word "interesado" matched. NOTE: unsubscribe / "don't
  // contact me" phrasing lives in DO_NOT_CONTACT below (checked first — la baja manda).
  /\bno\s+(me\s+|nos\s+|le\s+|les\s+|estamos?\s+|est[áa]n?\s+)?(\w+mente\s+)?interesad[oa]s?\b/i,
  // "no estoy/estás/está/estáis interesado" — the most common Spanish rejection; the line above
  // only had estamos/están, so "no estoy interesado" leaked to Interesado via the bare word.
  /\bno\s+est(oy|[áa]s|[áa]|[áa]is|ar[íi]a(mos)?|ar[ée](mos)?)\s+interesad[oa]s?\b/i,
  /\bno\s+(me\s+|nos\s+|le\s+|les\s+)?interesa[n]?\b/i,
  /\bno\s+(hay\s+)?inter[ée]s\b/i, /sin\s+inter[ée]s/i,
  /\bnot\s+interested\b/i, /\bno\s+interest\b/i, /pas\s+int[ée]ress[ée]/i, /kein\s+interesse/i, /non\s+(mi|ci)\s+interessa/i,
  /no\s+ens\s+interessa/i,
  /(no|not).{0,15}(a\s+)?(fit|good fit|match|lo que (buscamos|necesitamos))/i,
  /ya\s+(teng[oa]|tienes?|tienen|tenemos|cuent[oa]\s+con|cuentan\s+con|contamos con|trabaj[oa]\s+con|trabajan\s+con|trabajamos con|dispon(go|e|en|emos)\s+de|disponemos)/i, /already\s+(have|work with|use|using|got)/i,
  /(lo hacemos|lo llevamos|lo gestionamos|ho fem|ho gestionem|ho portem)\s+(internamente|internament|in[- ]?house|nosotros|nosaltres)/i,
  // "in-house" ONLY with a doing/having verb or a team/solution noun — a bare "in-house" matched a
  // signature tagline ("Your Outside In-House Counsel") and flipped a warm reply to not_interested.
  /\b(handle|do|did|does|manage|keep|build|built|develop|run|have|has|got|done|managed|handled)\w*\s+(?:[\w'-]+\s+){0,4}in[- ]?house\b/i,
  /\bin[- ]?house\s+(team|solution|system|department|developer|resources|capabilit|staff|people)/i,
  // NOTE: bare "internamente" was REMOVED here — corporate legal disclaimers ("este correo
  // solo puede distribuirse internamente…") made real referrals/replies read as not_interested.
  // "lo hacemos internamente" is still caught by the contextual pattern just above.
  /(no hay|sin)\s+(presupuesto|budget)/i, /(no es el|not the right)\s+momento/i, /(ahora|now)\s+no\s+(es el momento|toca)/i, /not?\s+(right\s+)?now/i,
  // "no tenemos presupuesto (disponible) para esta inversión" (real, Surinver) — the old
  // (no hay|sin) form missed the tener/disponer conjugations.
  /\bno\s+(tenemos|tengo|disponemos\s+de|contamos\s+con|queda|habr[áa])\s+(m[áa]s\s+)?(presupuesto|budget|partida|fondos)\b/i,
  /presupuesto\s+(disponible\s+)?(agotado|cerrado|congelado)/i,
  /no\s+es\s+(una\s+)?prioridad/i, /not\s+a\s+priority/i, /no\s+(es\s+)?prioritari/i,
  /(we'?re|estamos|estoy)\s+(all set|cubiertos|servidos)/i,
  // A bare "Gracias." is NOT a rejection (§13 case 46 → review): the "no" is now REQUIRED, so
  // courtesy alone can no longer close a lead, while "No, gracias." still rejects (case 51).
  /\bno,?\s+(gracias|thanks|thank\s*you|gr[àa]cies)\b/i, /no\s+thank/i,
  /\bno\s+(tengo|tenemos)\s+inter[ée]s\b/i,
  // "no queremos cambiar / contratar / una reunión / seguir con la propuesta" (cases 13, 30, 75).
  /\bno\s+(queremos|quiero|deseamos|deseo|vamos\s+a)\s+(cambiar|contratar|reunirnos|seguir|continuar|una\s+reuni[óo]n|ninguna\s+reuni[óo]n)\b/i,
  // A trailing bare "ahora no" (case 36: "Si nos interesara, pediríamos una reunión; ahora no").
  /(^|[.;,]\s*)ahora\s+no\s*[.!]*$/i,
  /no\s+(me\s+|nos\s+|le\s+|les\s+)?(interesan?|hace falta|necesit(o|a|amos|an)|encaja)/i,
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
  // "vuestras soluciones no tienen cabida aquí" (real case, Grupo Álava — was sitting under a
  // stale Interesado because nothing matched and neutral never downgrades a label).
  /no\s+(tienen?|tendr[íi]an?)\s+cabida/i,
  /\bno\s+(nos\s+)?(encaja|cuadra)\b/i, /\bno\s+va\s+con\s+nosotros\b/i,
  // ── "No need" / out-of-scope rejections in Spanish (real case, ANIMSA: a public company that
  // "solo presta servicios a … por lo que no tenemos la necesidad de captación de clientes").
  // None of the above matched, and the "clientes que tienen otras empresas" clause even leaked
  // into QUESTION. Polite but unambiguous NOs.
  /\bno\s+(tenemos|tengo|hay|existe|vemos|veo)\s+(la\s+|una\s+|ninguna\s+|esa\s+|esta\s+|dicha\s+|tal\s+|estas\s+|esas\s+)?necesidad(es)?\b/i,
  /\bsin\s+(la\s+)?necesidad\s+de\b/i,
  /\bno\s+(lo\s+|la\s+|los\s+|las\s+)?(necesitamos|necesito|precisamos|requerimos)\b/i,
  /\bno\s+(me\s+|nos\s+|le\s+|les\s+)?(hace|har[íi]a)\s+falta\b/i,
  /\bno\s+(hacemos|realizamos|llevamos\s+a\s+cabo)\s+(captaci[óo]n|prospecci[óo]n|acciones?\s+comercial|marketing|publicidad)/i,
  /\bno\s+(captamos|buscamos|contratamos|subcontratamos|externalizamos)\b/i,
  /\bno\s+(vamos\s+a|pensamos|tenemos\s+previsto|prevemos)\s+(contratar|necesitar|incorporar|externalizar|cambiar)/i,
  /\bno\s+trabajamos\s+con\s+(proveedores|empresas|agencias|terceros|externos)/i,
  /\b(solo|s[óo]lo|[úu]nicamente|exclusivamente)\s+(prest|trabaj|atend|oper|vend)\w*\s+(servicios?\s+)?(a|para|con)\b/i,
  /\b(somos|es)\s+(una\s+)?(empresa|entidad|organismo|sociedad|fundaci[óo]n|administraci[óo]n)\s+p[úu]blic[oa]/i,
  /\bno\s+(aplica|procede|corresponde|es\s+aplicable|es\s+de\s+aplicaci[óo]n)\b/i,
  /\bno\s+(nos\s+)?encaja\s+(en|con|para)\b/i,
];

// ── 2a-bis) SOFT rejections — polite "we're covered / not looking" replies that carry NO
// explicit "no" or "not interested", so the strong NOT_INTERESTED list missed them and they
// leaked as "neutral" (real case: "we currently have our own internal team that handles lead
// generation … we are not looking to add any external systems or services at this time").
// These ONLY count when the message shows NO interest/engagement signal (see classifyMessage),
// so a mixed "we have our own team but tell me more" still reads as interested.
const SOFT_REJECTION = [
  /\bnot\s+looking\s+(to|for|at|into)\b/i,
  /\bno\s+(plans?|need|intention|interest)\s+(to|for|of|in|at)\b/i,
  /\b(don'?t|do\s+not|won'?t|will\s+not)\s+(need|require|be\s+(adding|needing|looking))\b/i,
  /\b(have|got|use|using|maintain)\s+(our\s+own|an?\s+internal|an?\s+in[- ]?house|a\s+dedicated|an?\s+existing)\s+(team|solution|system|department|provider|setup|process|tool|stack|vendor|partner)\b/i,
  /\bour\s+own\s+(internal\s+)?(team|solution|system|department|setup|process|people|tools?)\b/i,
  /\b(handled?|managed?|covered|sorted|taken\s+care\s+of)\s+(internally|in[- ]?house)\b/i,
  /\bnot?\s+(adding|bringing\s+on|onboarding)\s+(any\s+)?(external|third[- ]?party|new|additional)\b/i,
  /no\s+(estamos|estoy|est[áa]n)\s+buscando/i,
  /(tenemos|contamos con|disponemos de)\s+(nuestro|un|una)\s+(propi[oa]|equipo\s+(interno|propio|dedicado|especializado|in[- ]?house)|soluci[óo]n\s+propia)/i,
  /\bequipo\s+(dedicado|especializado)\s+(exclusivamente\s+)?(a|en)\b/i,
  /(ya\s+)?lo\s+(tenemos|llevamos|gestionamos)\s+(cubierto|resuelto|montado)/i,
  /gracias\s+por\s+(el\s+ofrecimiento|la\s+oferta|tu\s+ofrecimiento)/i,
  /thanks?\s+for\s+the\s+offer\b/i,
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
  // "bájame / quítame / bórrame / elimíname DE la base de datos / lista / registro" — a very
  // common Spanish unsubscribe phrasing the "de baja" / "de la lista" patterns above missed. The
  // "verbo + de" shape keeps a service request ("eliminar duplicados de la base de datos") out.
  /(b[áa]j|qu[íi]t|b[óo]rr|elim[íi]n|s[áa]c)\w*\s+de\s+(la\s+|las\s+|vuestr[oa]s?\s+|su\s+|sus\s+|nuestr[oa]s?\s+|tus?\s+|mi\s+)?(base\s+de\s+datos|bbdd|listas?|registro|contactos?)\b/i,
  // "elimina mi correo de todas tus bases de datos" — removal verb SEPARATED from the target by
  // a few words (mi correo / todas tus). And "no quiero/deseo recibir (más) correos".
  /(elim[íi]n|b[óo]rr|qu[íi]t|b[áa]j|s[áa]c|dar\s+de\s+baja|dad\s+de\s+baja)\w*[^.?!\n]{0,45}\b(base[s]?\s+de\s+datos|bbdd|lista[s]?\s+de\s+(correo|distribuci[óo]n|env[íi]o)|lista[s]?\b|registro|distribuci[óo]n)\b/i,
  /\bno\s+(quiero|queremos|deseo|deseamos)\s+(recibir|que\s+me\s+(escrib|mand|env|contact|lleg))\w*(\s+m[áa]s)?\b[^.?!\n]{0,30}(correo|email|e-mail|comunicaci|newsletter|publicidad|comercial|mensaje)/i,
  /\bno\s+(quiero|queremos|deseo|deseamos)\s+(recibir\s+)?(m[áa]s\s+)?(correos?|emails?|e-mails?|comunicaciones|newsletters?|publicidad|spam)\b/i,
  /stop\s+(contact|email|writ|send|messag|reach)/i,
  /(no|don'?t|do not)\s+(me\s+|nos\s+)?(contact|email|write|escrib|contacte|env[íi]e|manden?|mand[ée]is)/i,
  /deja(d|r)?\s+de\s+(enviar|escribir|contactar|molestar|mandar)/i,
  /dej[ée]is\s+de\s+(enviar|escribir|contactar|molestar|mandar)/i,
  // "No quiero información ni llamadas" — an explicit stop to ALL communications (case 15).
  /\bno\s+quiero\b[^.?!]{0,30}\bni\b[^.?!]{0,25}\b(llamadas?|correos?|emails?|informaci[óo]n|que\s+me\s+llam)/i,
  // Catalan unsubscribe (cases 58 and real CA traffic).
  /\bno\s+m['’]escriviu\b/i, /\bno\s+em\s+(contacteu|escriviu|truqueu)\b/i, /doneu-?me\s+de\s+baixa/i, /\besborreu\b/i,
  /no\s+(me\s+|nos\s+)?(volv[áa]is|vuelvas?|volver)\s+a\s+(escribir|contactar|enviar|molestar|mandar)/i,
  /no\s+(me\s+|nos\s+)?(escrib[áa]is|escribas|contact[ée]is|mand[ée]is)\s+(m[áa]s|nunca m[áa]s)?/i,
  /leave (me|us) alone/i, /d[ée]jad?(me|nos) en paz/i, /\bgo away\b/i, /\bpls\s+delete\s+my\s+contact\b/i, /delete\s+my\s+(contact|details|data|email)/i,
  // RGPD / data protection
  /\brgpd\b/i, /\bgdpr\b/i, /\blopd\b/i,
  // NOT the bare footer phrases ("protección de datos", "datos personales") — those live in every
  // corporate signature and mislabeled warm replies as No contactar when the footer cut missed.
  // Only the sender's own complaint about THEIR data counts:
  /\b(mis|nuestros)\s+datos\b[^.?!\n]{0,60}(borr|elimin|suprim|quit|sacad|obtenid|conseguid|viol|protecci|rgpd|gdpr)/i,
  /(borra|elimina|quita|suprime|borrad|eliminad|quitad)\w*\s+(mis|nuestros)\s+datos/i,
  /(viola|infringe|incumple)\w*\s+(el\s+|la\s+)?(rgpd|gdpr|lopd|protecci[óo]n\s+de\s+datos)/i,
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
  /(debes|debe|deb[ée]is|deber[íi]as?|mejor|te recomiendo)\s+(hablar|contactar|escribir|dirigirte)\s+(con|a)\b/i,
  // 'con quién debes hablar es con Joaquín…' — redirect to a named person (old pattern needed
  // 'debes hablar con' adjacent; here it's 'quien debes hablar es con').
  /\bqui[ée]n\s+(debes|deber[íi]as|tienes\s+que|hay\s+que|puedes|ten[ée]is\s+que)\s+(hablar|contactar|dirigirte|escribir|tratarlo)/i,
  /\bdebes\s+(hablar|contactar|dirigirte|escribir)\s+(es\s+)?(con|a)\b/i,
  /\bcon\s+qui[ée]n\s+(hablar|contactar|tratarlo|verlo)\b/i,
  /(habla|contacta|escribe|dir[íi]gete)\s+(con|a)\s+(?!nosotros|nuestr|m[íi]\b|conmigo|el equipo\b)/i,
  /\b(se\s+)?(comuni(que|quen|carse)|p[óo]nga(se|nse)\s+en\s+contacto|ponerse\s+en\s+contacto|dir[íi]ja(se|nse)|dirigirse)\s+(con|a)\b/i,
  // "reach out to Marta / to our sales team" = referral, but "feel free to reach out to me/us/you"
  // is an INVITATION to contact the sender, not a hand-off → exclude me/us/you.
  /\breach out to\s+(?!me\b|us\b|you\b|our team\b)\S/i,
  /\b(please\s+)?(connect|coordinate|liaise|follow\s+up|speak|talk)\s+with\s+(?!me\b|us\b)[A-Z][a-z]+/,
  // Someone is being ADDED/looped in. The bare "in the loop" was removed: "keep me in the loop"
  // is the sender asking to stay informed (engagement), not a redirect to a third party.
  /\b(adding|looping|cc'?ing|copying)\s+[A-Za-z][\w./]*\s+(in\s+the\s+loop|in\s+cc|here)/i,
  /(tratar|ver|hablar|comentar|gestionar)(lo|la)?\s+con\s+(la\s+persona|el\s+(responsable|departamento|equipo)|mi\s+(compañer|jef|responsable)|nuestr[oa]s?\s+(responsable|equipo|departamento))/i, /you (should|can|may want to)\s+(contact|reach|talk to|speak with)\s+/i,
  /(is|es)\s+the\s+(right|best)\s+person/i, /(qui[ée]n|who)\s+(lo\s+)?(lleva|gestiona|se encarga|handles)/i,
  /(competencia|responsabilidad|cosa)\s+de\s+\w+/i,
  // "he reenviado tu correo", "forwarded your email to…". Bare "forward … to" was removed: it
  // matched "looking forward to your reply" (a positive close) → wrongly derivado. Requires the
  // completed/gerund form + an object, not the idiom "look forward to".
  /(reenv[íi]\w*|forwarded|forwarding)\s+(tu|este|esta|su|el|la|los|las|your|this|it|the)\b/i,
  // "He reenviado tu correo al área de compras / al departamento / al responsable" — a
  // referral to the right team, NOT a rejection (the disclaimer word "internamente" used
  // to leak these to not_interested).
  /reenvi\w+[^.?!]{0,30}\b(compras|departament\w*|[áa]rea|responsable|direcci[óo]n|equipo)\b/i,
  // "He pasado / se lo he trasladado vuestra propuesta al responsable" — a completed hand-off
  // (case 38). Past/participle forms only, so it can never read as a request to send us something.
  /\b(he|hemos|se\s+lo\s+he|se\s+lo\s+hemos|le\s+he|les\s+he)\s+(pasado|trasladado|reenviado|enviado|derivado|remitido|comentado)\b[^.?!]{0,40}\b(responsable|departament\w*|[áa]rea|direcci[óo]n|equipo|compras|jefe|encargad[oa]|direcci[óo]n)\b/i,
  // "No decido nada" / "no soy quien decide" — not the decision-maker → redirect, not a no.
  /\bno\s+decido\b/i, /no\s+soy\s+qui[ée]n\s+(decide|lo\s+decide)/i, /no\s+(soy\s+el\s+que\s+)?tom[oa]\s+(la|las|esa|estas)\s+decisi/i,
];

// ── 3) Interested ───────────────────────────────────────────────────────────
const INTERESTED = [
  /me\s+interesa/i, /nos\s+interesa/i, /est(oy|amos)\s+interesad/i, /\binteresad[oa]s?\b/i,
  /(i'?m|we'?re)\s+interested/i, /\binterested\b/i, /interess(a|ato|ati|ante)/i, /suona interessante/i, /sembra interessante/i,
  // French positive interest with the accented "é" ("ça m'intéresse", "cela nous intéresse",
  // "nous sommes intéressés"). The negative "(ne) … pas intéressé" is caught earlier by
  // NOT_INTERESTED, which is checked before this list, so these can't flip a rejection.
  /\bm['’\s]?int[ée]resse\b/i, /\bnous\s+int[ée]resse\b/i, /sommes\s+int[ée]ress[ée]s\b/i,
  /(me\s+)?parece\s+(interesante|bien|genial)/i, /suena\s+(bien|interesante|genial)/i, /sounds\s+(good|great|interesting)/i,
  /\b(vemos|veo|resulta|nos\s+parece|lo\s+vemos)\s+(muy\s+|bastante\s+|realmente\s+)?interesante/i,
  // A short reply that is basically a time slot ("5:00 pm Dubai time tomorrow") answers OUR meeting
  // proposal → interest. Anchored to a time + day word so timestamps in long mails don't count.
  /^\W*(\w+\W+){0,6}\d{1,2}([:.]\d{2})?\s*(am|pm|h|hrs)\b[^.!?]{0,40}\b(tomorrow|today|mañana|hoy|monday|tuesday|wednesday|thursday|friday|lunes|martes|mi[ée]rcoles|jueves|viernes)\b/i,
  /(let'?s|vamos a|podemos)\s+(talk|chat|connect|meet|hablar|vernos|reunir|quedar|agendar)/i,
  /hablemos/i, /me gustar[íi]a (hablar|saber|conocer|una|ver una)/i,
  /agend(a|ar|amos|emos|é)/i, /\breuni[óo]n\b/i, /\bmeeting\b/i, /schedule (a )?(call|meeting|time)/i,
  /(book|set up|schedule|reserv\w+|agend\w+|apunt\w+|organic\w+|concert\w+)\b[^.?!]{0,25}(call|time|slot|meeting|demo|llamada|reuni[óo]n|cita|hueco|chat)/i,
  /(me|nos)\s+encaja/i, /(me|nos)\s+(viene|va)\s+(bien|genial|perfecto)/i,
  // NOTE: the bare words "calendly"/"calendar" were REMOVED (§8): the seller's own booking link
  // quoted back by the lead does not prove interest — it sits in every signature. A real
  // "pásame tu Calendly" is caught by MEETING_OPENING instead.
  /(when|cu[áa]ndo)\s+(are you|est[áa]s|est[áa]is|puedes|podemos|would you|te viene)/i,
  // A prospect stating THEIR OWN availability to meet = interest. The bare
  // "disponible"/"available" was REMOVED: it matched "servicio disponible 24/7",
  // "producto no disponible", "horario disponible"… (a THING being available, not the
  // person) → false "Interesado" (real case: a Colegio de Aparejadores newsletter).
  // "¿cuándo estás disponible?" is still caught by the when/cuándo meeting pattern below.
  /(?<!\bno\s)est(oy|amos)\s+disponibl\w*/i, /(i'?m|we'?re)\s+available\b/i, /(mi|nuestra)\s+disponibilidad\b/i,
  // "¿Tenéis hueco el jueves?" — asking for a slot/time to meet = a warm meeting ask.
  /\bhueco\b/i, /(ten[ée]is|tienes|ten[ée]s|hay|te va bien|os va bien|te viene|os viene|te encaja)\b[^.?!]{0,25}(hueco|disponib|un (rato|momento|hueco)|libre|para (hablar|vernos|una (llamada|reuni)))/i,
  // A proposed time ONLY counts as interest when it sits next to a meeting word. A bare
  // "a las 10:00" / "el jueves 20" / "10h" is NOT interest — it shows up in timestamps,
  // signatures and out-of-office notes, which used to leak as false "Interesado".
  /(reuni[óo]n|llamada|call|meeting|demo|cita|vernos|quedar|hablar)\b[^.?!]{0,30}\b((a|sobre) l[ao]s \d{1,2}|\d{1,2}\s*(h|hrs|am|pm)\b|(lunes|martes|mi[ée]rcoles|jueves|viernes|monday|tuesday|wednesday|thursday|friday))/i,
  /((a|sobre) l[ao]s \d{1,2}|\d{1,2}\s*(h|hrs|am|pm)\b|(lunes|martes|mi[ée]rcoles|jueves|viernes))\b[^.?!]{0,30}(reuni[óo]n|llamada|call|meeting|demo|cita|vernos|quedar|hablar|me (viene|va) bien|te (viene|va) bien|perfecto)/i,
  SEND_INFO,
  /(quiero|queremos|me gustar[íi]a)\s+(una demo|probar|ver[l]?o|conocer)/i,
  /(s[íi]|yes)[,! ]+(claro|por supuesto|encantad|adelante|please|sure|absolutely|of course|me interesa|hablamos)/i,
  /(adelante|dale|perfecto,?\s*hablamos|vamos adelante|go ahead|let'?s do it)/i,
  // Acceptance + awaiting-your-reply (real case, ASG: "De acuerdo. Vamos a ver ese análisis
  // que comentas… Quedo pendiente de tus noticias" — a skeptical but ENGAGED yes, was sitting
  // under a stale "No contactar"). Kept in INTERESTED (not ENGAGEMENT) so an explicit
  // rejection in the same mail still wins.
  // "De acuerdo/Ok/Vale" + real content = acceptance. A bare "Ok." is not interest, and neither
  // is "Ok, gracias." — §8: courtesy ("gracias", "recibido") never creates interest on its own.
  /^\s*(de acuerdo|ok|vale|perfecto)\b[.,!;\s]+(?!(gracias|gr[àa]cies|thanks|thank|saludos|un\s+saludo|salut|regards|atentamente|recibido)\b)(?=\S.{3,})/i,
  /(vamos a|queremos|quiero|me gustar[íi]a)\s+ver\s+(ese?|esa|el|la|los|las|vuestr[oa]|tu)?\s*(an[áa]lisis|propuesta|informe|demo|documento|material|datos|estudio)/i,
  /quedo\s+(pendiente|a\s+la\s+espera|atent[oa])\s+de\s+(tus?|sus?|vuestras?)\s+(noticias?|respuesta|env[íi]o|informaci[óo]n|propuesta|an[áa]lisis)/i,
];

// ── 4) Question / doubt ─────────────────────────────────────────────────────
const UNCERTAIN = [
  /no\s+s[ée]\s+si\s+(me|nos|le)?\s*(interesa|conviene|sirve|aplica|encaja)/i,
  /not\s+sure\s+(if|whether|about)/i, /no\s+(lo\s+)?tengo\s+claro/i, /no\s+est(oy|amos)\s+segur/i,
  /(quiz[áa]s|tal vez|maybe|perhaps)\b/i,
];
const QUESTION = [
  // Interrogative ONLY at a sentence/clause start or right after "¿" — a bare "que tiene" is a
  // relative clause ("clientes que tienen otras empresas", real ANIMSA false positive).
  /(^|[.!?¿;:]\s*|\s¿\s*)(cu[áa]nto|qu[ée]|c[óo]mo|cu[áa]l|cu[áa]ndo|d[óo]nde|por qu[ée])\s+(cuesta|vale|precio|cost|incluye|funciona|es|ser[íi]a|hac|puedo|podemos|ser|tiene)/i,
  /(how|what|which|when|where|why)\s+(much|does|is|are|can|would|about|kind|type|exactly)/i,
  /\b(pregunta|duda|consulta)s?\b/i, /tengo una (pregunta|duda|consulta)/i, /a\s+question/i,
  /(podr[íi]as?|podr[íi]ais|puedes|pod[ée]is|could you|can you|would you)\b/i,
  /(do|does|are|is|can)\s+you\s+(offer|have|provide|support|work|charge|include)/i,
  /me puedes? (decir|explicar|contar|mandar|enviar|dar)/i,
  /\?/,
];

// ═══════════════════════════════════════════════════════════════════════════════
// SPEC "reglas_clasificacion_leads" (2026-09-09) — commercial-opening precedence.
//
// Core invariant (§1 / §5 steps 3-4): a lead who ASKS FOR or ACCEPTS a meeting, call,
// demo or a price/proposal is INTERESADO **even if they voice objections** ("ya tenemos
// proveedor, pero podemos conoceros"). Only an opening that is REAL and AFFIRMED counts —
// a negated one ("no queremos una reunión"), a mere mention ("estoy en una reunión"), a
// quoted seller line or a signature booking link never create interest (§8).
//
// This block runs BEFORE referral/rejection so the invariant holds; everything it does not
// decide falls through to the original, real-case-tuned ladder below (no regression).
// ═══════════════════════════════════════════════════════════════════════════════

// Adversative/sentence boundaries. Splitting on these (NOT on commas — "No, gracias" must
// stay one clause) is what lets "No estoy interesado, PERO podemos reunirnos" read as an
// opening while "No queremos una reunión" stays negated.
// NOTE the lookaheads instead of a trailing \b on the accented words: "ò" is not a \w character,
// so `per[òo]\b` never matched Catalan "però" — the sentence was not split and the negation of
// the first clause wrongly cancelled the opening in the second (case 56).
const ACC_END = String.raw`(?![\wáéíóúàèòïüçñ])`;
const CLAUSE_SPLIT = new RegExp(
  String.raw`[.;!?¡¿\n]+|\bpero\b|\baunque\b|\bsin\s+embargo\b|\bno\s+obstante\b|\beso\s+s[íi]${ACC_END}|\bahora\s+bien\b|\bbut\b|\bthough\b|\balthough\b|\bhowever\b|\bper[òo]${ACC_END}|\btot\s+i\s+aix[íò]${ACC_END}`,
  "i",
);

/** A negation ("no/ni/nunca…") within the 4 words before the phrase cancels it. "sin" is
 *  deliberately NOT a negator — "sin compromiso podemos vernos" is still an opening (§8). */
// The window is TIGHT (2 words): a negation must sit right next to the phrase it cancels.
// With a wider window "No sé si me interesa, pásame más información" had its info request
// cancelled by the distant "no" — yet §6 makes that request Interesado.
const NEG_BEFORE = /\b(no|ni|nunca|jam[áa]s|tampoco|not|don'?t|doesn'?t|won'?t|neither)\b(?:\W+\w+){0,2}\W*$/i;
/** "si nos interesara, pediríamos…" — a counterfactual is not a real offer (case 36). */
const COUNTERFACTUAL = /\bsi\b[^.;!?]{0,40}\b\w+(ar[íi]a|er[íi]a|ir[íi]a|ara|iera|ase|iese)\w*\b/i;
/** The opening must concern OUR offer, not support/billing (case 74, §6). */
const NON_COMMERCIAL_TOPIC = /\b(soporte|support|factura|invoice|incidencia|reclamaci[óo]n|aver[íi]a|garant[íi]a|pedido\s+n|ticket|devoluci[óo]n)\b/i;

const MEET_VERB = String.raw`(quiero|queremos|quisiera|quisi[ée]ramos|me\s+gustar[íi]a|nos\s+gustar[íi]a|podemos|podr[íi]amos|puedo|podr[íi]a|pod[ée]is|podr[ée]is|hagamos|hacemos|montamos|organizamos|programemos|agendamos|agendemos|agendar|reservemos|quedamos|necesito|solicito|pido|acepto|podem|podr[íi]em|fem|farem)`;
const MEET_NOUN = String.raw`(reuni[óo]n\w*|reunirnos|reunirme|reunir\w*|reuni[óo]|llamada|videollamada|videoconferencia|demo\w*|presentaci[óo]n|cita|hueco|call|meeting|conocer\w*|con[èe]ixer\w*|hablar|parlar|vernos|veure'?ns|verlo|verlos|comentarlo|escuchar\w*)`;

const MEETING_OPENING: RegExp[] = [
  // The tail is a LOOKAHEAD, not \b: an accented ending ("reunió") is not a \w character, so a
  // trailing \b never matched it and the whole Catalan opening was missed (case 56).
  new RegExp(String.raw`\b${MEET_VERB}\b[^.;!?]{0,35}\b${MEET_NOUN}(?![\wáéíóúàèòïüçñ])`, "i"),
  // "quedamos"/"agendar" alone were REMOVED: "Quedamos a su disposición" is standard courtesy in
  // every Spanish business signature and read as "let's meet". The verb+noun rule still catches
  // "quedamos para una reunión"; these bare forms are unambiguous.
  /\b(agendamos|agendemos|agendam[oa]s|reservemos)\b/i,
  /\b(os|te|le|les)\s+escucho\b/i, /\bpuedo\s+escuchar\w*/i,

  /\bp[áa]sa(me|nos)\b[^.;!?]{0,25}\b(calendly|calendario|agenda|enlace|link|disponibilidad)\b/i,
  /\b(env[íi]a|manda|pasa)\w*\s*(me|nos)?\b[^.;!?]{0,20}\b(invitaci[óo]n|invite|enlace\s+(de|para)\s+la\s+(reuni[óo]n|llamada))\b/i,
  /\btengo\s+(un\s+)?hueco\b/i, /\btengo\s+disponibilidad\b/i,
  /\b(happy|glad)\s+to\s+(chat|talk|meet|connect|discuss|jump\s+on|hop\s+on|learn\s+more)\b/i,
  /\blet'?s\s+(meet|talk|chat|connect|discuss|schedule|set\s+up)\b/i,
  /\b(book|schedule|set\s+up|arrange)\s+(a|the)\s+(call|meeting|demo|time)\b/i,
  /\bsend\s+(me\s+|us\s+)?(your\s+)?(calendar|booking\s+link|availability)\b/i,

  // A concrete slot offered as a SHORT reply to an invitation ("El martes a las 12.")
  /^\W*(el\s+)?(lunes|martes|mi[ée]rcoles|jueves|viernes|dilluns|dimarts|dimecres|dijous|divendres)\b[^.]{0,25}\b\d{1,2}([:.]\d{2})?\s*(h|hrs|am|pm)?\b/i,
];

/** WEAK openings: real interest on their own, but ALSO what an out-of-office note says
 *  ("si es urgente llámame al 600…"). They only count when the message is NOT announcing an
 *  absence — 36 real absence notes were being turned into "Interesado" by exactly this. */
const MEETING_OPENING_WEAK: RegExp[] = [
  /\b(ll[áa]ma(me|nos)|ll[áa]meme|ll[áa]menme|truca'?m)\b/i,
  /\b(me\s+va\s+bien|me\s+encaja|em\s+va\s+b[ée]|works\s+for\s+me|sounds\s+good)\b/i,
];

const COMMERCIAL_EXPLORATION: RegExp[] = [
  // Spanish interrogatives are ANCHORED to a clause start / "¿" — otherwise the RELATIVE pronoun
  // "que" matches: "los servicios QUE OFRECÉIS" was read as "¿qué ofrecéis?" and turned a plain
  // rejection ("no nos interesan los servicios que ofrecéis") into Interesado.
  /(^|[.!?¿;:]\s*|\s¿\s*)(cu[áa]nto\s+(cuesta|vale|ser[íi]a|cobr\w*)|qu[ée]\s+precio)/i,
  /\b(how\s+much|pricing|quote)\b/i,
  /(^|[.!?¿;:]\s*|\s¿\s*)(qu[ée]\s+(incluye|ofrec[ée]is))/i,
  /\b(what'?s\s+included|what\s+does\s+it\s+include)\b/i,
  // The verb must be an IMPERATIVE or a first-person desire — the \b after the group is what
  // keeps "He pasado vuestra propuesta al responsable" (a REFERRAL, case 38) from reading as a
  // request: "pasa" there is followed by "do", so the boundary fails.
  /\b(?:(?:env[íi]a|m[áa]nda|p[áa]sa)(?:d?(?:me|nos))?|(?:enviar|mandar|pasar|facilitar|remitir)(?:me|nos)|d[ií](?:me|nos)|dame|dadme|necesito|necesitamos|quiero|queremos|quisiera|me\s+gustar[íi]a|nos\s+gustar[íi]a|solicito|send|share)\b\s*(?:me|us|nos)?\b[^.;!?]{0,28}\b(precios?|presupuesto|tarifas?|cotizaci[óo]n|propuesta|proposal|dossier|informaci[óo]n|info\b(?!@)|detalles?|material|more\s+information|details)\b/i,
  // Concrete future follow-up ("escríbeme en octubre para revisarlo") = SEGUIMIENTO_FUTURO,
  // which §6 classifies as Interesado. A vague "ya veremos" never matches (needs a real date).
  // The verb MUST carry the enclitic "me/nos": the author asking US to come back to THEM. The
  // loose form matched an out-of-office footer ("para urgencias contacte con Maria en el 600…")
  // and turned 38 real absence notes into "Interesado".
  /\b(escr[íi]be(?:me|nos)|escrib[íi]d(?:me|nos)|cont[áa]cta(?:me|nos)|contactad(?:me|nos)|ll[áa]ma(?:me|nos)|ret[óo]ma(?:lo|melo)|dame\s+un\s+toque|dadme\s+un\s+toque)\b[^.;!?]{0,30}\b(en|el|dentro\s+de|despu[ée]s\s+de|tras|a\s+partir\s+de)\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre|verano|vacaciones|navidad|unas?\s+semanas?|un\s+mes|unos\s+meses|el\s+pr[óo]ximo|\d{1,2})/i,
  /(^|[.!?¿;:]\s*|\s¿\s*)(c[óo]mo\s+(funciona|empezamos|empiezo|comenzamos|lo\s+hacemos|ser[íi]a\s+el\s+proceso))/i,
  /\b(how\s+(does\s+it\s+work|do\s+we\s+start))\b/i,
  /\b(cu[ée]nta|expl[íi]ca|d[íi])(me|nos)\b[^.;!?]{0,20}\b(m[áa]s|sobre|acerca)\b/i, /\btell\s+me\s+more\b/i,
  /\b(ejemplos?|casos?\s+(de\s+)?([ée]xito|clientes|pr[áa]cticos)|referencias|case\s+stud|testimonios)\b/i,
  /\b(m[ée]s\s+informaci[óo]|envia'?m\s+informaci[óo])\b/i,
];

/** Does an AFFIRMED, commercially-relevant match of `pats` exist in some clause? */
function hasAffirmedOpening(text: string, pats: RegExp[]): boolean {
  for (const clause of text.split(CLAUSE_SPLIT)) {
    const c = clause.trim();
    if (!c) continue;
    if (NON_COMMERCIAL_TOPIC.test(c)) continue;   // support/billing, not our offer
    if (COUNTERFACTUAL.test(c)) continue;         // "si nos interesara, pediríamos…"
    for (const p of pats) {
      const re = new RegExp(p.source, p.flags.replace("g", ""));
      const m = re.exec(c);
      if (m && !NEG_BEFORE.test(c.slice(0, m.index))) return true;
    }
  }
  return false;
}

/** Purely automatic mail — stop the commercial analysis (§5 step 2). A HUMAN message that
 *  merely mentions being away ("estoy fuera, pero podemos hablar el lunes") does NOT. */
const STRONG_AUTO = [
  /respuesta\s+autom[áa]tica/i, /automatic(ally)?\s+repl/i, /auto(mated)?[- ]?reply/i, /automated\s+response/i,
  /automatische\s+antwort/i, /r[ée]ponse\s+automatique/i, /risposta\s+automatica/i, /resposta\s+autom[àa]tica/i,
  /^\s*auto\s*:/i, /\bout\s+of\s+office\s+(auto)?repl/i,
  /\b(hemos|he)\s+recibido\s+(su|tu)\s+(mensaje|correo|solicitud)/i, /we\s+have\s+received\s+your\s+(message|email|request)/i,
  /acuse\s+de\s+recibo/i, /this\s+is\s+an\s+automated/i, /no\s+responda\s+a\s+este\s+(correo|mensaje)/i,
];

/** "Ya tenemos proveedor" ALONE is ambiguous — it can precede an opening, so per §7 it is a
 *  REVIEW, not a rejection. With any other rejection signal it stays not_interested. */
const BARE_PROVIDER = /\b(ya\s+)?(teng[oa]|tienes?|tienen|tenemos|contamos\s+con|cuento\s+con|trabajamos?\s+con|trabajo\s+con|disponemos\s+de|ja\s+tenim)\s+(un[oa]?\s+|otro\s+|otra\s+|nuestro\s+|nuestra\s+)?(proveedor\w*|agencia\w*|partner\w*|prove[ïi]dor\w*)\b/i;
/** "No soy la persona adecuada" with NO named target → review, never an invented referral (case 40). */
const NOT_RIGHT_PERSON = /\bno\s+soy\s+(yo\s+)?(la\s+|el\s+)?(persona\s+)?(indicad[oa]|adecuad[oa]|correct[oa]|encargad[oa]|responsable|qui[ée]n)/i;
/** A cessation written in the FIRST PERSON — unmistakably the author's own words, not the
 *  unsubscribe boilerplate every corporate footer carries. Only these override an absence note. */
const AUTHOR_DNC: RegExp[] = [
  /\b(d[aá]dme|dame|dadnos|danos)\s+de\s+baja\b/i, /\bme\s+doy\s+de\s+baja\b/i,
  /\bb[óo]rr(ame|adme|enme|anos|adnos)\b/i, /\belim[íi]n(ame|adme|enme|anos|adnos)\b/i,
  /\bqu[íi]t(ame|adme|enme|anos|adnos)\b/i, /\bs[áa]c(ame|adme|enme|anos)\b/i,
  /\bno\s+(me|nos)\s+(escrib|contact|mand|env[íi]|llam)/i,
  /\bno\s+(me|nos)\s+volv(?:[áa]is|as|amos)?\s+a\s+(escribir|contactar|enviar|mandar|llamar)/i,
  /\bdeja(?:d|r)?\s+de\s+(enviarme|escribirme|contactarme|mandarme|molestarme)/i,
  /\bdej[ée]is\s+de\s+(enviarme|escribirme|contactarme|mandarme)/i,
  /\bremove\s+me\b/i, /\bunsubscribe\s+me\b/i, /\btake\s+me\s+off\b/i, /\bstop\s+emailing\s+me\b/i,
  /\bno\s+m['’]escriviu\b/i, /\bno\s+em\s+(contacteu|escriviu)\b/i, /\bdoneu-?me\s+de\s+baixa\b/i,
];

const HAS_EMAIL = /\b[\w.+-]+@[\w.-]+\.\w{2,}\b/;

export function classifyMessage(subject: string | null, body: string | null): MessageCategory {
  const subjectText = prep(subject);
  const bodyText = prep(body);
  const text = `${subjectText} ${bodyText}`.trim();
  if (text.replace(/\s+/g, "").length < 2) return "neutral"; // nothing meaningful to read

  // ── §5.1 Delivery events: a bounce is a delivery fact, never a human intent (case 68).
  if (any(SYSTEM_BOUNCE, text)) return "out_of_office";

  // ── §5.2 A PURELY automatic message carries no human intent at all — stop here (41, 42, 45).
  if (any(STRONG_AUTO, text)) return "out_of_office";

  // Computed once: it decides BOTH whether an absence note is really a human reply (case 43)
  // and the Interesado verdict below.
  const strongOpening = hasAffirmedOpening(text, MEETING_OPENING) || hasAffirmedOpening(text, COMMERCIAL_EXPLORATION);
  const announcesAbsence = any(LEFT_COMPANY, text) || any(OUT_OF_OFFICE, text);
  // Inside an absence note, an opening phrased as an INSTRUCTION to us ("para agendar llamadas
  // podéis reservar en este enlace", "please contact +33…", "para cualquier urgencia") is the
  // auto-reply's standard boilerplate, not the person answering our offer. A first-person
  // commitment ("podemos agendar una reunión", "envíame una convocatoria") is unaffected.
  const IMPERSONAL_INSTRUCTION = /\b(pod[ée]is|pueden|puede\s+(contactar|escribir|dirigirse)|please\b|for\s+(any\s+)?\w{2,12}\s+request|para\s+(cualquier|asuntos?|urgencias?|agendar|toda)|en\s+caso\s+de|si\s+(es|fuera)\s+urgente|veuillez\s+contacter|pod(eu|reu)|si\s+hi\s+ha(gu[ée]s)?|per\s+(a\s+)?(qualsevol|urg)|en\s+cas\s+de|por\s+si\s+quieres|te\s+dejo\s+mi\s+(calendario|agenda)|a\s+la\s+vuelta|a\s+mi\s+(vuelta|regreso)|cuando\s+(vuelva|regrese))\b/i;
  // A WEAK opening ("llámame", "me va bien") only counts outside an absence note.
  const opening = (announcesAbsence && IMPERSONAL_INSTRUCTION.test(text))
    ? false
    : strongOpening || (!announcesAbsence && hasAffirmedOpening(text, MEETING_OPENING_WEAK));

  // ── §5.2 Absence / left-the-company, checked BEFORE the cessation rule ON PURPOSE: an
  // out-of-office auto-reply very often carries an "unsubscribe / darse de baja" link in its
  // FOOTER, and reading that as the person's own request wrongly suppressed real leads (53 real
  // messages found in the history). Guarded three ways: it never applies when the person opened
  // the door ("estoy fuera, pero podemos hablar el lunes", case 43), when they say they are BACK,
  // or when the cessation is written in the FIRST PERSON — those words are the author's, not a
  // footer's, so a genuine "estoy de vacaciones… y no me escribáis más" still unsubscribes.
  const RETURNED = /\b(acabo|acabamos|reci[ée]n)\s+(de\s+)?(regres|volv|vuelt)\w*|\b(ya\s+)?(he|hemos)\s+(vuelto|regresado)\b|\b(regres[ée]|regresamos|volv[íi]|volvimos)\s+de\s+(las?\s+|mis\s+)?vacaciones|\bde\s+vuelta\s+(de|en|al?)\b|\bestoy\s+de\s+vuelta\b|\bback\s+from\s+(my\s+|the\s+)?(holiday|vacation|leave|trip)\b|\b(just|now)\s+(got\s+)?back\b/i;
  const returned = RETURNED.test(text);
  if (!opening && !returned && !any(AUTHOR_DNC, text)) {
    // A PERMANENT exit with an explicit hand-off is a referral, not an absence (§7).
    // A permanent exit that names a replacement (a referral phrase OR simply an alternative
    // address) is a hand-off, not an absence (§7).
    if (any(LEFT_COMPANY, text)) return (any(REFERRAL, text) || HAS_EMAIL.test(text)) ? "derivado" : "out_of_office";
    if (any(OUT_OF_OFFICE, text)) return "out_of_office";
  }

  // ── §5.1 An explicit cessation request outranks everything else a human wrote, including an
  // accompanying interest ("me interesa, pero eliminadme de la lista", case 18) or a call asked
  // for only to demand that we stop writing (case 53). "La baja manda".
  if (any(DO_NOT_CONTACT, text)) return "no_contactar";

  // ── §5.3 / §5.4 THE INVARIANT: a real, AFFIRMED commercial opening (meeting/call/demo, or a
  // price/proposal/info request) is INTERESADO even alongside objections — "ya tenemos proveedor
  // pero podemos conoceros", "no tengo presupuesto ahora, pero hagamos una reunión". Runs before
  // referral and rejection so an objection can never bury a genuine opening.
  if (opening) return "interested";

  // ── §7 "No soy la persona adecuada" with NO named target or address → REVIEW. Never invent a
  // referral contact (case 40).
  if (NOT_RIGHT_PERSON.test(text)) {
    const rest = text.replace(new RegExp(NOT_RIGHT_PERSON.source, "gi"), " ");
    if (!HAS_EMAIL.test(text) && !any(REFERRAL, rest)) return "neutral";
  }

  // ── §5.5 Hands you off to someone else ("esto lo lleva Marta") — a redirect, not a no.
  if (any(REFERRAL, text)) return "derivado";

  const hasEngagement = any(ENGAGEMENT, text);
  const hasInterest = any(INTERESTED, text);

  // ── §7 A BARE "ya tenemos proveedor" does NOT prove a rejection — it often precedes an
  // opening. With no other rejection signal left once that phrase is removed, keep the previous
  // state and review (case 29). "…y no queremos cambiar" still rejects (case 30).
  if (BARE_PROVIDER.test(text)) {
    const rest = text.replace(new RegExp(BARE_PROVIDER.source, "gi"), " ");
    if (!hasEngagement && !hasInterest && !any(NOT_INTERESTED, rest) && !any(SOFT_REJECTION, rest)) return "neutral";
  }

  // ── §5.6 Clearly not interested (unless they still asked for info / a call).
  if (!hasEngagement && any(NOT_INTERESTED, text)) return "not_interested";

  // 3b) SOFT rejection ("we have our own team / not looking to add …") — only when there is NO
  // interest OR engagement signal at all, so a genuine warm reply is never misread as a no.
  // A soft-rejection formula next to a GENUINE question must not swallow the question
  // (real case, Tomebamba: "Gracias por la oferta ¿Qué tipo de productos puedes encontrar?").
  if (!hasEngagement && !hasInterest && !any(QUESTION, text) && any(SOFT_REJECTION, text)) return "not_interested";

  // ── §5.8 Pure doubt with no decision behind it ("quizás algún día", "no lo tengo claro") is
  // NOT a question to answer: keep the previous state and review (case 33). Returning "neutral"
  // is exactly that — the labeler never overwrites an existing label with it.
  if (any(UNCERTAIN, text)) return "neutral";

  // §6 — the opening must concern OUR offer. "Me gustaría hablar con vuestro soporte por una
  // factura" (case 74) is a support/billing request, not new commercial interest, so the legacy
  // interest/engagement lists must not fire on it either.
  const nonCommercial = NON_COMMERCIAL_TOPIC.test(text);

  // 3) Interested (positive buying signals).
  if (hasInterest && !nonCommercial) return "interested";

  // Asked for info / a call (without doubt or a rejection) → that's a warm lead.
  if (hasEngagement && !nonCommercial) return "interested";

  // 4) A genuine question.
  if (any(QUESTION, text)) return "question";

  return "neutral";
}
