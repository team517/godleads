// Fuera de oficina → ¿cuándo vuelve? (10-11-2026). Parte PURA (con pruebas en src/test/ooo-return.test.ts).
//
// Cuando un lead contesta con un "estoy fuera hasta el 21 de octubre", la campaña le deja de escribir
// hasta ese día y ese mismo día recibe el siguiente correo de la secuencia. Aquí sólo se interpreta
// el texto: qué fecha vuelve (o null) y cuándo programar el envío en la zona horaria de la campaña.
//
// Reglas (es/en/fr/it/de/pt), de más a menos fiable:
//   1. "vuelvo / me incorporo / back on / de retour le / rientro il / zurück am X"   → X
//   2. rangos "del 19 al 30 de octubre / from 7th to 16th / du 19 au 30"            → fin + 1
//   3. "hasta / until / till / jusqu'au / fino al / bis X"                           → X + 1
//   4. "a partir del / desde el / ab / available from X"                             → X
//   5. mes sin día ("hasta mayo de 2027")                                             → día 1
//   6. día de la semana sin número ("until Monday")                                   → ese día
//   7. "hasta mañana / until tomorrow"                                                → recibido + 1
//   8. fechas sin palabra clave (en el texto del autor)                               → la última + 1
// Lo que no son vacaciones (ya no trabaja aquí, buzón cerrado, antispam…) → sin fecha.

export type OooRule = "vuelta" | "rango" | "hasta" | "desde" | "mes" | "dia_semana" | "manana" | "ultima_fecha";

export interface OooParse {
  /** Día en que vuelve, "YYYY-MM-DD", o null si el texto no lo dice con claridad. */
  date: string | null;
  rule: OooRule | null;
  /** El texto dice que NO es una ausencia temporal (ya no trabaja aquí, buzón cerrado, antispam…). */
  notVacation: boolean;
  /** Hay referencias de tiempo sin resolver (meses, números, días, "semana"): candidato para la IA. */
  hasTimeRef: boolean;
}

/* ── Normalización ─────────────────────────────────────────────────────────────────────────── */

const strip = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/** Corta la cita del correo original ("On 4 Nov 2026, Alonso wrote:", "El … escribió:", "> …",
 *  "De: … Enviado:", "-----Original Message-----"): sus fechas no son las de la vuelta. */
export function cortarCita(raw: string): string {
  const t = String(raw || "");
  const marcas = [
    /\bon\s.{3,120}?\swrote:/i,
    /\bel\s.{3,120}?\sescribi[oó]:/i,
    /\ble\s.{3,120}?\sa\s[ée]crit\s?:/i,
    /\bil\s.{3,120}?\sha\sscritto:/i,
    /\bam\s.{3,120}?\sschrieb\s/i,
    /\bem\s.{3,120}?\sescreveu:/i,
    /-{2,}\s*(original message|mensaje original|message d'origine|messaggio originale)/i,
    /(^|\n)\s*(de|from|von|da):\s.{0,160}?(enviado|sent|gesendet|envoy[ée]|inviato)\s*:/i,
    /(^|\n)\s*>/,
  ];
  let corte = t.length;
  for (const re of marcas) {
    const m = re.exec(t);
    if (m && m.index < corte) corte = m.index;
  }
  return t.slice(0, corte);
}

function normalizar(raw: string): string {
  return strip(cortarCita(raw))
    .toLowerCase()
    .replace(/&#39;|&apos;|[\u2018\u2019\u00b4`]/g, "'")
    .replace(/[*_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* ── Vocabulario ───────────────────────────────────────────────────────────────────────────── */

const MESES: Record<string, number> = {};
const addMeses = (lista: string[]) => lista.forEach((n, i) => { if (n) MESES[n] = i + 1; });
addMeses(["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]);
addMeses(["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"]);
addMeses(["janvier", "fevrier", "mars", "avril", "mai", "juin", "juillet", "aout", "septembre", "octobre", "novembre", "decembre"]);
addMeses(["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"]);
addMeses(["januar", "februar", "marz", "april", "mai", "juni", "juli", "august", "september", "oktober", "november", "dezember"]);
addMeses(["janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"]);
addMeses(["", "", "", "", "", "", "", "", "setiembre", "", "", ""]);
addMeses(["gener", "febrer", "", "", "maig", "juny", "juliol", "", "", "", "", "desembre"]); // catalán (el resto coincide)
// Abreviaturas (sólo cuentan pegadas a un número: "28th Oct", "Nov 29th").
addMeses(["jan", "feb", "mar", "apr", "", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]);
addMeses(["ene", "", "", "abr", "", "", "", "ago", "sept", "", "", "dic"]);
addMeses(["", "", "", "", "", "", "", "", "", "okt", "", "dez"]);
addMeses(["", "fev", "", "", "", "", "", "", "set", "out", "", ""]);

const MES_ALT = Object.keys(MESES).sort((a, b) => b.length - a.length).join("|");
/** Nombres completos (los que valen sin número al lado: "hasta mayo de 2027"). */
const MES_LARGO = /^(gener|febrer|maig|juny|juliol|desembre|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre|january|february|march|april|june|july|august|september|october|november|december|janvier|fevrier|avril|juin|juillet|aout|septembre|octobre|novembre|decembre|gennaio|febbraio|aprile|maggio|giugno|luglio|settembre|ottobre|dicembre|januar|februar|marz|juni|juli|oktober|dezember|janeiro|fevereiro|maio|junho|julho|setembro|outubro|novembro|dezembro)$/;

const DIAS: Record<string, number> = {
  domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6,
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
  dimanche: 0, lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6,
  domenica: 0, lunedi: 1, martedi: 2, mercoledi: 3, giovedi: 4, venerdi: 5, sabato: 6,
  sonntag: 0, montag: 1, dienstag: 2, mittwoch: 3, donnerstag: 4, freitag: 5, samstag: 6,
  segunda: 1, terca: 2, quarta: 3, quinta: 4, sexta: 5,
  diumenge: 0, dilluns: 1, dimarts: 2, dimecres: 3, dijous: 4, divendres: 5, dissabte: 6,
};
const DIA_ALT = Object.keys(DIAS).sort((a, b) => b.length - a.length).join("|");

const ORD = "(?:st|nd|rd|th|er|eme|º|°|o)?";
const RELLENO = `(?:\\s*,?\\s+(?:el|la|le|il|the|o|a|dia|next|proximo|proper|prochain|prossimo|naechsten|nachsten|${DIA_ALT}),?)*`;

const KW_VUELTA = "a mon retour|returning to (?:work|the office|my desk)(?: on)?|returning|come back (?:to [a-z ]{0,25}?)?on|coming back on|back by|reincorporacion(?: sera| el| prevista para el| esta prevista para el)?|incorporacion(?: sera| el)?|mi vuelta(?: sera| el)?|a mi vuelta el|be available (?:again )?(?:on|in|from)|will be available (?:on|in)|available again on|tornare el|tornare|tornarem|vuelvo|volvere|vuelva|regreso|regresare|regresaremos|me incorporo|me incorporare|incorporare|reincorporare|me reincorporo|estare de vuelta|estare de nuevo|de vuelta (?:el|a partir del)|back on|back in the office on|back in office on|be back on|be back|i'll be back|i will be back|return on|returning on|return to the office on|resume [a-z ]{0,30}?on|resuming [a-z ]{0,30}?on|de retour le|de retour|serai de retour|retour le|rentre le|rientro il|rientro|rientrero|saro di nuovo|di ritorno il|zuruck am|zuruck ab|wieder im buro|wieder erreichbar ab|wieder da am|volto no dia|volto a|estarei de volta|regresso em|retorno em|retorno el";
const KW_HASTA = "until and including|up to and including|hasta e incluido|fins al|fins a|fins el|hasta|until|till|til|thru|through|jusqu'au|jusqu'a|jusqu au|jusqu a|fino al|fino a|fino alla|bis zum|bis|ate ao|ate|hasta el dia";
const KW_DESDE = "a partir del|a partir de|desde el|available from|available again from|available on|disponible a partir del|disponible desde|ab dem|ab|dal|des le|a partir du";

const CONTEXTO_VUELTA = /(disponib|availab|vuelta|retour|wieder|torn|rientr|incorpor|regres|volv|back|zuruck)/;
const reFinal = (kw: string) => new RegExp(`(?:^|[^a-z])(?:${kw})${RELLENO}\\s*$`);
const RE_FIN_VUELTA = reFinal(KW_VUELTA);
const RE_FIN_HASTA = reFinal(KW_HASTA);
const RE_FIN_DESDE = reFinal(KW_DESDE);

const NO_VACACIONES = /(retirement|jubilacion|me jubilo|retraite|pensione|ruhestand|dejare de (formar parte|trabajar|estar)|dejara de (formar parte|existir|estar operativ)|dejo de (formar parte|trabajar)|deja de (formar parte|existir)|queda inhabilitad|ha sido inhabilitad|ha cambiado de (posicion|puesto|empresa|departamento|cargo)|su nuevo correo|mi nuevo correo|my new (e-?mail|address)|new email address is|ya no (forma parte|trabaja|esta en|pertenece)|no longer (with|part|works?|employed|at|available at)|has left (the|our)|left the company|ha dejado (la empresa|de trabajar|de formar)|causado baja|causo baja|ha sido dad[oa] de baja|ya no esta operativ|no esta operativ|dejara de estar operativ|dejo de estar operativ|cuenta (ha sido )?(cerrada|desactivada|eliminada)|mailbox (is )?no longer|this (e-?mail|mailbox|address) is no longer|mailinblack|protegid[oa] (contra|por protect)|n'?est plus (en poste|joignable|dans|chez|actif)|ne fait plus partie|non (fa|lavora) piu|nicht mehr (bei|im unternehmen|tatig|aktiv)|nao (faz|trabalha) mais)/;

const REF_TIEMPO = new RegExp(`(\\d|\\b(${MES_ALT}|${DIA_ALT}|semana|semanas|week|weeks|semaine|semaines|settimana|settimane|woche|wochen|mes|meses|month|months|mois|mese|mesi|monat|monate|manana|tomorrow|demain|domani|morgen|amanha)\\b)`);

/* ── Fechas ────────────────────────────────────────────────────────────────────────────────── */

const DAY = 86_400_000;
const ymd = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const valida = (y: number, m: number, d: number) => {
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return false;
  const t = new Date(ymd(y, m, d));
  return t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
};

/** Año: el explícito, o el de la recepción; si entonces queda ANTES de la recepción y es enero-marzo
 *  recibido en octubre-diciembre ("vuelvo el 7 de enero" escrito en diciembre), el año siguiente. Una
 *  fecha pasada de otro mes se deja pasada: es un contestador olvidado, la persona ya ha vuelto. */
function conAnio(m: number, d: number, y: number | null, recibido: number): number | null {
  const r = new Date(recibido);
  let anio = y ?? r.getUTCFullYear();
  if (y !== null && y < 100) anio = 2000 + y;
  if (!valida(anio, m, d)) return null;
  let t = ymd(anio, m, d);
  if (y === null && t < recibido && r.getUTCMonth() >= 9 && m <= 3 && valida(anio + 1, m, d)) t = ymd(anio + 1, m, d);
  return t;
}

interface Cand { ms: number; idx: number; end: number; tipo: "fecha" | "num" | "mes" | "dia" }

function candidatos(t: string, recibido: number): Cand[] {
  const out: Cand[] = [];
  const ocupado = (i: number, j: number) => out.some((c) => i < c.end && j > c.idx);
  const push = (c: Cand) => { if (!ocupado(c.idx, c.end)) out.push(c); };
  let m: RegExpExecArray | null;
  // 26 de octubre (de 2026) · 2nd of November · 28th Oct · 26 octobre · 26. Oktober
  const reDM = new RegExp(`(^|[^\\d])(\\d{1,2})${ORD}\\.?\\s*(?:de\\s+|d'\\s*|of\\s+|-\\s*)?(${MES_ALT})\\b\\.?(?:,?\\s*(?:de\\s+|del\\s+)?(\\d{4}))?`, "g");
  while ((m = reDM.exec(t))) {
    const ms = conAnio(MESES[m[3]], Number(m[2]), m[4] ? Number(m[4]) : null, recibido);
    if (ms !== null) push({ ms, idx: m.index + m[1].length, end: m.index + m[0].length, tipo: "fecha" });
  }
  // 02Nov2026 · 19OCT2026 (todo junto)
  const reJunto = new RegExp(`(^|[^\\d])(\\d{1,2})(${MES_ALT})(\\d{4})(?!\\d)`, "g");
  while ((m = reJunto.exec(t))) {
    const ms = conAnio(MESES[m[3]], Number(m[2]), Number(m[4]), recibido);
    if (ms !== null) push({ ms, idx: m.index + m[1].length, end: m.index + m[0].length, tipo: "fecha" });
  }
  // October 28 · Nov 29th · January 7th, 2027
  const reMD = new RegExp(`\\b(${MES_ALT})\\.?,?\\s+(?:the\\s+)?(\\d{1,2})${ORD}\\b(?:,?\\s*(\\d{4}))?`, "g");
  while ((m = reMD.exec(t))) {
    const ms = conAnio(MESES[m[1]], Number(m[2]), m[3] ? Number(m[3]) : null, recibido);
    if (ms !== null) push({ ms, idx: m.index, end: m.index + m[0].length, tipo: "fecha" });
  }
  // 21/10 · 21.10.2026 · 11/15 (inglés: se da la vuelta si el "mes" pasa de 12)
  const reNum = /(^|[^\d.:/\-+])(\d{1,2})[/.\-](\d{1,2})(?:[/.\-](\d{4}|\d{2}))?(?![\d:/]|\.\d)/g;
  while ((m = reNum.exec(t))) {
    let d = Number(m[2]), mo = Number(m[3]);
    if (mo > 12 && d <= 12) [d, mo] = [mo, d];
    const ms = conAnio(mo, d, m[4] ? Number(m[4]) : null, recibido);
    if (ms !== null) push({ ms, idx: m.index + m[1].length, end: m.index + m[0].length, tipo: m[4] ? "fecha" : "num" });
  }
  // mayo de 2027 · mayo (sin día)
  const reMes = new RegExp(`\\b(${MES_ALT})\\b(?:\\s+(?:de\\s+|del\\s+)?(\\d{4}))?`, "g");
  while ((m = reMes.exec(t))) {
    if (!MES_LARGO.test(m[1])) continue;
    const ms = conAnio(MESES[m[1]], 1, m[2] ? Number(m[2]) : null, recibido);
    if (ms !== null) push({ ms, idx: m.index, end: m.index + m[0].length, tipo: "mes" });
  }
  // the 19th · Monday 26th · el 19 (día suelto: mes de la fecha anterior del texto o de la recepción)
  const reDia = new RegExp(`(?:\\b(?:${DIA_ALT})\\s+|\\b(?:the|el|le|il|am|dia|o)\\s+)(\\d{1,2})${ORD}\\b(?!\\s*(?:[/.:\\-]\\d|%|h\\b|horas|hours|am\\b|pm\\b|€|eur|euros|dias|days|jours|giorni|tage|semanas|weeks))`, "g");
  while ((m = reDia.exec(t))) {
    const d = Number(m[1]);
    const antes = out.filter((c) => c.tipo === "fecha" && c.idx < m!.index).sort((a, b) => b.idx - a.idx)[0];
    const r = new Date(recibido);
    let y = r.getUTCFullYear(), mo = r.getUTCMonth() + 1;
    if (antes) { const a = new Date(antes.ms); y = a.getUTCFullYear(); mo = a.getUTCMonth() + 1; }
    if (!valida(y, mo, d)) continue;
    let ms = ymd(y, mo, d);
    if (!antes && ms < recibido) { mo += 1; if (mo > 12) { mo = 1; y += 1; } if (!valida(y, mo, d)) continue; ms = ymd(y, mo, d); }
    push({ ms, idx: m.index, end: m.index + m[0].length, tipo: "dia" });
  }
  return out.sort((a, b) => a.idx - b.idx);
}

/** Interpreta un fuera de oficina. `recibidoIso`: cuándo llegó (para el año y "mañana"). */
export function parseOooReturn(texto: string, recibidoIso: string): OooParse {
  const t = normalizar(texto);
  const r0 = Date.parse(recibidoIso);
  const recibido = Number.isFinite(r0) ? Date.UTC(new Date(r0).getUTCFullYear(), new Date(r0).getUTCMonth(), new Date(r0).getUTCDate()) : Date.UTC(1970, 0, 1);
  const vacio: OooParse = { date: null, rule: null, notVacation: false, hasTimeRef: REF_TIEMPO.test(t) };
  if (!t) return vacio;
  if (NO_VACACIONES.test(t)) return { ...vacio, notVacation: true };

  const cands = candidatos(t, recibido);
  const prefijo = (c: Cand) => t.slice(Math.max(0, c.idx - 60), c.idx);
  const res = (ms: number, rule: OooRule): OooParse => ({ date: iso(ms), rule, notVacation: false, hasTimeRef: true });

  // 1. vuelta explícita → ese día (si hay varias, la última)
  const vuelta = cands.filter((c) => RE_FIN_VUELTA.test(prefijo(c)));
  if (vuelta.length) return res(Math.max(...vuelta.map((c) => c.ms)), "vuelta");

  // 2. rangos: dos fechas unidas por "al / to / - / au / until / fino al / bis…" → fin + 1
  const reRango = new RegExp(`(?:\\b(?:des del|del|de|from|du(?:\\s+les?)?|dal|vom|entre(?:\\s+el)?|between)\\s+)?(\\d{1,2})${ORD}(?:\\s*(?:de\\s+|of\\s+)?(${MES_ALT})\\b\\.?)?\\s*(?:fins al|al|a|to|-|–|y el|and|au|fino al|bis zum|bis|hasta el|until|till|e)\\s+(?:el\\s+|le\\s+|the\\s+|il\\s+)?(\\d{1,2})${ORD}\\s*(?:de\\s+|of\\s+)?(${MES_ALT})?\\b\\.?(?:,?\\s*(?:de\\s+)?(\\d{4}))?`, "g");
  const reRangoMD = new RegExp(`\\b(?:from|del|de|du|dal|vom)?\\s*(${MES_ALT})\\.?\\s+(\\d{1,2})${ORD}\\s*(?:to|-|–|until|till|al|au|bis|through|thru)\\s+(?:(${MES_ALT})\\.?\\s+)?(\\d{1,2})${ORD}\\b(?:,?\\s*(\\d{4}))?`, "g");
  const finesRango: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = reRango.exec(t))) {
    const mesFin = m[4] || m[2];
    if (!mesFin && !/\b(del|from|du|dal|vom|entre|between)\s/.test(m[0])) continue;
    const r = new Date(recibido);
    const mo = mesFin ? MESES[mesFin] : r.getUTCMonth() + 1;
    if (Number(m[3]) < Number(m[1]) && !m[2]) continue;
    const ms = conAnio(mo, Number(m[3]), m[5] ? Number(m[5]) : null, recibido);
    if (ms !== null) finesRango.push(ms);
  }
  while ((m = reRangoMD.exec(t))) {
    const mo = MESES[m[3] || m[1]];
    const ms = conAnio(mo, Number(m[4]), m[5] ? Number(m[5]) : null, recibido);
    if (ms !== null) finesRango.push(ms);
  }
  if (finesRango.length) return res(Math.max(...finesRango) + DAY, "rango");

  // 3. hasta / until X → X + 1 (el mes sin día no suma: "hasta mayo" = vuelve en mayo)
  const hasta = cands.filter((c) => RE_FIN_HASTA.test(prefijo(c)));
  const hastaFecha = hasta.filter((c) => c.tipo !== "mes");
  if (hastaFecha.length) return res(Math.max(...hastaFecha.map((c) => c.ms)) + DAY, "hasta");

  // 4. a partir de / desde X → X
  // "a partir del 28" a secas es cuando se VA; sólo cuenta si habla de estar disponible o de vuelta.
  const desde = cands.filter((c) => c.tipo !== "mes" && RE_FIN_DESDE.test(prefijo(c)) && CONTEXTO_VUELTA.test(prefijo(c)));
  if (desde.length) return res(Math.max(...desde.map((c) => c.ms)), "desde");

  // 5. mes sin día → día 1
  const mes = cands.filter((c) => c.tipo === "mes" && (RE_FIN_HASTA.test(prefijo(c)) || RE_FIN_VUELTA.test(prefijo(c)) || RE_FIN_DESDE.test(prefijo(c))));
  if (mes.length) return res(Math.max(...mes.map((c) => c.ms)), "mes");

  // 6. día de la semana sin número ("until Monday", "hasta el lunes", "jusqu'à lundi")
  const reSemana = new RegExp(`(?:^|[^a-z])(?:${KW_HASTA}|${KW_VUELTA})\\s+(?:(?:el|le|il|the|next|proximo|prochain)\\s+)?(${DIA_ALT})\\b(?!\\s*,?\\s*(?:\\d|(?:${MES_ALT})\\b))`);
  const ws = reSemana.exec(t);
  if (ws) {
    const objetivo = DIAS[ws[1]];
    let ms = recibido + DAY;
    while (new Date(ms).getUTCDay() !== objetivo) ms += DAY;
    return res(ms, "dia_semana");
  }

  // 7. hasta mañana → recibido + 1
  if (new RegExp(`(?:^|[^a-z])(?:${KW_HASTA}|${KW_VUELTA})\\s+(?:(?:el|le|il)\\s+)?(manana|tomorrow|demain|domani|morgen|amanha)\\b`).test(t)) return res(recibido + DAY, "manana");

  // 8. fechas sin palabra clave en un fuera de oficina → la última + 1 (sólo fechas completas)
  const sueltas = cands.filter((c) => c.tipo === "fecha");
  if (sueltas.length) return res(Math.max(...sueltas.map((c) => c.ms)) + DAY, "ultima_fecha");

  return vacio;
}

/* ── Validación y programación ─────────────────────────────────────────────────────────────── */

/** Más allá de esto no se espera: es un error de lectura o una baja larga sin fecha real. */
export const MAX_DIAS_ESPERA = 400;

/** "futura" = merece esperar; "pasada" = ya ha vuelto (o vuelve hoy); "lejana" = no fiable. */
export function evaluarVuelta(fecha: string | null, recibidoIso: string): "futura" | "pasada" | "lejana" | "sin_fecha" {
  if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return "sin_fecha";
  const r = new Date(recibidoIso);
  const recibido = Date.UTC(r.getUTCFullYear(), r.getUTCMonth(), r.getUTCDate());
  const t = Date.parse(fecha + "T00:00:00Z");
  if (!Number.isFinite(t)) return "sin_fecha";
  if (t <= recibido) return "pasada";
  if (t - recibido > MAX_DIAS_ESPERA * DAY) return "lejana";
  return "futura";
}

function offsetMs(utcMs: number, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const p: Record<string, string> = {};
  for (const x of dtf.formatToParts(new Date(utcMs))) p[x.type] = x.value;
  return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute), Number(p.second)) - utcMs;
}

/** Instante UTC de "fecha a las `hora`:00" en la zona `tz` (Europe/Madrid si no es válida). */
export function horaLocalAUtc(fecha: string, hora: number, tz: string): string {
  let zona = tz || "Europe/Madrid";
  try { new Intl.DateTimeFormat("en-US", { timeZone: zona }); } catch { zona = "Europe/Madrid"; }
  const [y, mo, d] = fecha.split("-").map(Number);
  const h = Number.isFinite(hora) && hora >= 0 && hora <= 23 ? hora : 9;
  const guess = Date.UTC(y, mo - 1, d, h);
  const off = offsetMs(guess, zona);
  let t = guess - off;
  const off2 = offsetMs(t, zona);
  if (off2 !== off) t = guess - off2;
  return new Date(t).toISOString();
}

/** Cuándo se le vuelve a escribir: el día que vuelve, a la hora de inicio de la campaña; si cae en
 *  sábado o domingo, el lunes. */
export function programarVuelta(fecha: string, tz: string | null | undefined, horaInicio: number | null | undefined): string {
  let t = Date.parse(fecha + "T00:00:00Z");
  const dow = new Date(t).getUTCDay();
  if (dow === 6) t += 2 * DAY;
  else if (dow === 0) t += DAY;
  return horaLocalAUtc(iso(t), horaInicio ?? 9, tz || "Europe/Madrid");
}
