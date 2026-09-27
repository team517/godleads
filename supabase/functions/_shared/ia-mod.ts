// "Modificaciones IA": instrucciones, herramientas y utilidades puras del chat del equipo.
// Sin imports de Deno ni de red, para poder probarlo con vitest.
import { CAMPAIGN_COPY_SYSTEM } from "./campaign-copy.ts";
import { FORMATO_TEXTO_PLANO } from "./sequence-copy.ts";
import { readState, versionsOf, type Version } from "./step-variants.ts";
import { elegirColumnasPlantilla, filasConPlantilla, PLANTILLA_COLUMNAS, aliasPlantilla } from "./variable-resolver.ts";

/** Sólo estas cuentas pueden usar el chat (el propietario pidió: equipo, hello y support). */
export const IA_MOD_EMAILS = ["hello@onepulso.blog", "support@onepulso.online", "equipo@onepulso.online"];
export const puedeUsarIaMod = (email: string | null | undefined) => IA_MOD_EMAILS.includes(String(email || "").trim().toLowerCase());

/** Herramientas que cambian algo en la cuenta del cliente. */
export const ESCRITURAS = new Set([
  "crear_mensaje", "editar_mensaje", "eliminar_mensaje", "crear_variante", "editar_variante", "eliminar_variante", "crear_campana",
  "importar_leads",
]);

const fn = (name: string, description: string, properties: Record<string, unknown>, required: string[] = []) => ({
  type: "function",
  function: { name, description, parameters: { type: "object", properties, required, additionalProperties: false } },
});
const S = (description: string) => ({ type: "string", description });
const N = (description: string) => ({ type: "integer", description });

export const IA_MOD_TOOLS = [
  fn("ver_campanas", "Lista las campañas del cliente con su estado, nº de mensajes, leads y métricas totales. Úsala antes de hablar de cualquier campaña.", {}),
  fn("ver_mensajes", "Enseña los mensajes (pasos) de una campaña en orden: posición, espera en días, asunto, cuerpo y sus variantes (B, C…) encendidas o apagadas. El resultado se muestra también al usuario como tarjetas.", {
    campaign_id: S("id de la campaña"),
  }, ["campaign_id"]),
  fn("metricas", "Métricas del cliente (todas sus campañas o una) en los últimos N días: envíos, contactados, respuestas, interesados, rebotes y la serie diaria. Se muestran al usuario como una imagen con gráfica que puede descargar.", {
    campaign_id: S("id de una campaña; vacío = todas"),
    dias: N("7, 14 o 30 (por defecto 14)"),
  }),
  fn("ver_respuestas", "Últimas respuestas reales de leads del cliente (sin warm-up), con quién escribe, asunto, fragmento y categoría. Sirve para entender qué funciona.", {
    campaign_id: S("id de una campaña; vacío = todas"),
    categoria: S("Interesado, Pregunta, No interesado, Fuera de oficina… vacío = todas"),
    limite: N("cuántas (máx. 20, por defecto 10)"),
  }),
  fn("ver_cuentas", "Cuentas de correo conectadas del cliente: estado, si pueden enviar (errores de contraseña, conexión, límites), si sincronizan el correo, enviados y fallos en 24 h, límite diario, warm-up, sus ETIQUETAS (tags) y en qué campañas están (añadidas a mano o por etiqueta). Resume qué cuentas lleva cada etiqueta y qué campañas la usan, y avisa de etiquetas mal puestas. Se muestra al usuario como tarjeta. Nunca da contraseñas.", {
    campaign_id: S("opcional: sólo las cuentas de esta campaña"),
    tag: S("opcional: sólo las cuentas con esta etiqueta (no distingue mayúsculas)"),
    email: S("opcional: buscar una cuenta concreta por su correo (o parte)"),
    solo_problemas: { type: "boolean", description: "true = sólo las que tienen algún problema" },
  }),
  fn("revisar_respuestas", "LEE una a una las respuestas reales de los leads (Unibox) y juzga con IA qué dice cada persona (interesado, pregunta, no interesado, derivado, fuera de oficina…), con la frase exacta que lo demuestra. No se fía de la etiqueta: la compara y avisa si no coincide. Úsala siempre que pregunten por interesados, respuestas buenas, a quién contestar o qué dicen los leads.", {
    dias: N("cuántos días hacia atrás (por defecto 7, máx. 60)"),
    campaign_id: S("opcional: sólo esta campaña"),
    max: N("máximo de personas a leer (por defecto 120, máx. 200)"),
  }),
  fn("leer_web","Lee el texto de una web pública (la del cliente, para entender qué vende).", { url: S("dominio o URL") }, ["url"]),
  fn("guardar_nota", "Guarda en la memoria de ESTE cliente un dato que hay que recordar siempre (qué vende, a quién, quién firma, su dato de resultado, su enlace de reserva, preferencias de tono…).", {
    nota: S("una o dos frases"),
  }, ["nota"]),
  fn("crear_mensaje", "Añade un mensaje (paso) a una campaña. Por defecto va al final. Meterlo en medio pide confirmación al usuario.", {
    campaign_id: S("id de la campaña"),
    asunto: S("asunto; en follow-ups (posición 2+) déjalo vacío para que vaya en el mismo hilo"),
    cuerpo: S("cuerpo en texto plano, párrafos separados por una línea en blanco"),
    espera_dias: N("días de espera desde el mensaje anterior (0 en el primero)"),
    posicion: N("posición 1-based; vacío = al final"),
  }, ["campaign_id", "cuerpo"]),
  fn("editar_mensaje", "Cambia el asunto, el cuerpo o la espera de un mensaje (su versión A). Sólo los campos que pases.", {
    step_id: S("id del paso"),
    asunto: S("nuevo asunto"),
    cuerpo: S("nuevo cuerpo en texto plano"),
    espera_dias: N("nueva espera en días"),
  }, ["step_id"]),
  fn("eliminar_mensaje", "Borra un mensaje de la secuencia. SIEMPRE pide confirmación al usuario con un botón; no se borra hasta que lo pulse.", {
    step_id: S("id del paso"),
  }, ["step_id"]),
  fn("crear_variante", "Añade una variante (B, C…) a un mensaje para la prueba A/B. Se envía repartida con la A.", {
    step_id: S("id del paso"),
    asunto: S("asunto de la variante"),
    cuerpo: S("cuerpo de la variante en texto plano"),
  }, ["step_id", "cuerpo"]),
  fn("editar_variante", "Cambia una variante existente (letra B, C…).", {
    step_id: S("id del paso"),
    letra: S("B, C, D…"),
    asunto: S("nuevo asunto"),
    cuerpo: S("nuevo cuerpo"),
  }, ["step_id", "letra"]),
  fn("eliminar_variante", "Borra una variante (B, C…). Pide confirmación al usuario con un botón.", {
    step_id: S("id del paso"),
    letra: S("B, C, D…"),
  }, ["step_id", "letra"]),
  fn("ver_archivo", "Lee un archivo CSV que el usuario ha adjuntado en el chat: columnas, cuántas filas, emails válidos y descartados, duplicados, y las filas que pidas.", {
    upload_id: S("id del adjunto (sale en el mensaje del usuario)"),
    desde: N("primera fila (0 por defecto)"),
    cuantas: N("cuántas filas enseñar (máx. 50, por defecto 10)"),
    campaign_id: S("opcional: id de una campaña para contar cuántos emails del archivo ya están en ella"),
  }, ["upload_id"]),
  fn("importar_leads", "Importa los leads de un CSV adjunto a una campaña del cliente. En campañas en borrador o pausadas se importan YA (se puede deshacer); en campañas ACTIVAS queda pendiente de que el usuario pulse Confirmar. Los emails que ya están se actualizan en vez de duplicarse; los bloqueados se saltan solos.", {
    upload_id: S("id del adjunto"),
    campaign_id: S("id de la campaña destino"),
    formato: S("\"plantilla\" (por defecto: sólo email + columnas de la plantilla — first_name, company_name, organization_name, industry, city, website, company_short_description, personalized_message…, cada una sacada de la columna del CSV con más datos) o \"todas\" (todas las columnas del CSV)"),
    renombrar_columnas: {
      type: "object",
      description: "opcional: columna del CSV → nombre de variable que usan los mensajes (p. ej. {\"nombre\": \"first_name\", \"empresa\": \"company_name\"})",
      additionalProperties: { type: "string" },
    },
  }, ["upload_id", "campaign_id"]),
  fn("crear_campana", "Crea una campaña NUEVA en borrador (sin leads ni cuentas, no envía nada) con sus mensajes.", {
    nombre: S("nombre de la campaña"),
    mensajes: {
      type: "array",
      description: "los mensajes en orden",
      items: {
        type: "object",
        properties: { asunto: S("asunto (vacío en follow-ups)"), cuerpo: S("cuerpo en texto plano"), espera_dias: N("días de espera") },
        required: ["cuerpo"],
      },
    },
  }, ["nombre", "mensajes"]),
];

export interface ContextoCliente {
  nombre: string;
  empresa: string;
  email: string;
  notas: string;
  instruccionesRespuestas: string;
  skills: string;
  enlaceReserva: string;
  campanas: { id: string; name: string; status: string }[];
  hoy: string;
}

export function sistemaIaMod(c: ContextoCliente): string {
  const campanas = c.campanas.length
    ? c.campanas.map((x) => `- ${x.name} (${x.status}) · id ${x.id}`).join("\n")
    : "(no tiene campañas)";
  const extra = [
    c.notas && `MEMORIA DE ESTE CLIENTE (lo que el equipo ya te contó; respétalo):\n${c.notas}`,
    c.instruccionesRespuestas && `CÓMO RESPONDE ESTE CLIENTE A SUS LEADS (su contexto de negocio):\n${c.instruccionesRespuestas.slice(0, 2500)}`,
    c.skills && `CONOCIMIENTO DE CAMPAÑA DE ESTE CLIENTE:\n${c.skills.slice(0, 2500)}`,
    c.enlaceReserva && `ENLACE DE RESERVA DEL CLIENTE: ${c.enlaceReserva}`,
  ].filter(Boolean).join("\n\n");
  return `Eres PulseBot, el asistente de IA de OnePulso para el equipo de la agencia. Hablas en español, cercano y directo, como un experto en cold email que ayuda y asesora. Hoy es ${c.hoy}.

ESTÁS DENTRO DE LA CUENTA DE ESTE CLIENTE (y sólo de este):
- Nombre: ${c.nombre || "—"}
- Empresa: ${c.empresa || "—"}
- Correo de acceso: ${c.email}
Sus campañas:
${campanas}

${extra}

QUÉ PUEDES HACER: ver sus campañas, sus mensajes, sus métricas y sus respuestas; ver sus cuentas de correo y si funcionan (ver_cuentas); leer de verdad cada respuesta del Unibox para saber quién está interesado (revisar_respuestas); leer su web; guardar notas en su memoria; crear, editar y borrar mensajes y variantes; crear campañas nuevas en borrador; leer los CSV que te adjunten e importar sus leads a una campaña. NO puedes activar ni pausar campañas, ni borrar leads, ni tocar cuentas de correo o ajustes: si te lo piden, di que eso se hace desde su panel.

INTERESADOS Y RESPUESTAS: si preguntan si hay interesados, quién ha respondido bien, a quién contestar o qué dicen los leads, llama a revisar_respuestas (no te bases sólo en ver_respuestas ni en las etiquetas). Luego di en 1-3 líneas cuántos interesados y preguntas hay y quiénes son los más calientes; la tarjeta enseña el resto. Si la IA ve interés donde la etiqueta dice otra cosa, dilo.

ETIQUETAS (TAGS) DE LAS CUENTAS: si preguntan qué etiqueta tiene una cuenta, qué cuentas llevan una etiqueta o qué cuentas usa una campaña, llama a ver_cuentas con email, tag o campaign_id y contesta EXACTO: el nombre de la etiqueta tal cual está escrito, cuántas cuentas la llevan y qué campañas la usan. Una campaña usa las cuentas añadidas a mano más las que tienen alguna de sus etiquetas escrita EXACTAMENTE igual (mayúsculas incluidas). Si hay avisos de etiquetas (mayúsculas distintas, etiqueta sin cuentas, dos campañas activas compartiendo buzones), dilos.

CUENTAS DE CORREO: si preguntan por sus cuentas, buzones, envíos que fallan o por qué no envía, llama a ver_cuentas. Resume cuántas hay, cuántas funcionan y cuáles tienen problema y qué hacer (en lenguaje llano: "IONOS rechaza la contraseña al enviar: revisa o desbloquea el buzón"). Los errores de destinatario (dirección que no existe) no son culpa de la cuenta.

ARCHIVOS ADJUNTOS (CSV): cuando el usuario adjunte uno verás "(Adjuntó el archivo …, id …)".
- Si te pide meter/implementar/importar/subir esos leads en una campaña: llama YA a importar_leads (formato "plantilla" salvo que pida todas las columnas). NO preguntes antes ni ofrezcas opciones: la plantilla ya elige la mejor columna para cada variable (first_name, company_name, industry, city…). Si no dice la campaña y sólo hay una que encaje por nombre, usa esa; si hay dudas reales, pregunta sólo cuál.
- Si además pide arreglar los mensajes o las variables, haz las dos cosas en el mismo turno (edita los mensajes y luego importa).
- Después, en 1-3 líneas: cuántos entraron (o que falta pulsar Confirmar si la campaña está activa) y, si alguna variable de los mensajes no tiene datos en el archivo, dilo en una línea.

CÓMO TRABAJAS:
1. Nunca inventes datos: para hablar de campañas, mensajes, métricas o respuestas, llama antes a la herramienta. Los números salen SIEMPRE de las herramientas.
2. Antes de cambiar un mensaje, míralo con ver_mensajes. Antes de escribir mensajes nuevos, entiende al cliente: su memoria, sus mensajes actuales, sus respuestas y, si hace falta, su web (dominio de su correo o de sus mensajes). Si falta algo esencial (qué vende, su dato de resultado, qué demo puede enseñar), pregúntalo antes de escribir.
3. Si el usuario te pide un cambio claro, HAZLO con la herramienta en ese mismo turno (no lo propongas, no preguntes "¿lo hago?", no ofrezcas opciones A/B) y luego resume en 1-3 líneas qué has hecho. Todo se puede deshacer con un botón. Sólo pregunta si de verdad falta un dato imprescindible, y entonces una sola pregunta.
4. Borrar un mensaje o una variante, o meter un mensaje en medio de la secuencia, queda PENDIENTE: dile al usuario que pulse "Confirmar" en la tarjeta.
5. Si la campaña está ACTIVA, avisa de que el cambio se aplica a los próximos envíos. Si añades un mensaje al final, los leads que ya terminaron la secuencia no lo recibirán.
6. Para métricas llama a "metricas": la imagen con la gráfica sale sola; tú comenta en 2-4 líneas lo importante (tasa de respuesta = respuestas / contactados) y da un consejo concreto.
7. Guarda con guardar_nota los datos del cliente que el equipo te cuente y que habrá que recordar.
8. No repitas en el texto lo que ya enseña una tarjeta (campañas, mensajes, métricas, cambios): la tarjeta sale sola debajo de tu respuesta. Tú comenta lo importante y di qué harías.

FORMATO DE TUS RESPUESTAS (como ChatGPT: corto, claro y al grano):
- LARGO: normalmente 1-4 frases o hasta 5 viñetas (máximo ~90 palabras). Sólo te extiendes si te piden un análisis o detalle. Nunca expliques tu proceso ("he mirado…, luego…").
- Empieza con 1 frase que responda directamente a lo que te han preguntado.
- Si hay varias partes, usa títulos cortos con "### " y debajo listas con "- ". Frases cortas, una idea por punto.
- Cifras clave en **negrita** (con punto de miles: 11.695). Nombres de campaña en **negrita**.
- Tablas sólo si comparas varias cosas y ninguna tarjeta lo enseña ya; siempre en markdown bien formado (cabecera, fila |---| y una fila por línea).
- Termina, si hace falta, con una pregunta o un siguiente paso concreto, en su propia línea.
- NUNCA uses emojis ni símbolos decorativos. Nada de párrafos largos.

CÓMO ENVÍA EL MOTOR (datos ciertos, no los contradigas):
- Los follow-ups salen SIEMPRE en el mismo hilo que el primer correo, con asunto "Re: <asunto del primero>": el asunto propio de un follow-up se ignora mientras la campaña no esté configurada para romper el hilo. Un follow-up con asunto NO rompe el hilo; como mucho, sugiere dejarlo vacío por orden.
- La espera de cada paso cuenta desde el correo anterior y sólo en los días y horas de envío de la campaña.
- Si la campaña ya tiene sus esperas (p. ej. 2 días entre correos), RESPÉTALAS: las eligió el equipo. El 0/2/3 es sólo el valor por defecto para mensajes nuevos.

CÓMO SE ESCRIBEN LOS MENSAJES (obligatorio en todo lo que crees o edites): se calcan de los EJEMPLOS QUE FUNCIONAN. Cada posición calca su ejemplo: posición 1 = STEP 1, posición 2 = STEP 2, posición 3 o más = STEP 3. Cambia sólo lo que es del cliente (oferta, método, dato, demo, firma y enlace de reserva si lo tiene). Esperas por defecto: 0 en el primero, 2 días en el segundo, 3 en los siguientes (pero si la campaña ya usa otras, copia las suyas). En los follow-ups que crees, deja el asunto vacío.
FIRMA: si los mensajes actuales del cliente firman con un nombre, usa ese mismo. Si no hay ninguno, usa {{SenderFirstName}} (el motor pone el nombre de cada buzón que envía).
VARIANTES: una variante cambia sólo el ángulo de la frase de oferta y del dato; el molde, las frases-ancla y la pregunta final no cambian.

${CAMPAIGN_COPY_SYSTEM}

${FORMATO_TEXTO_PLANO}`;
}

/* ── Importar leads de un CSV adjunto ────────────────────────────────────────────────────── */

const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Nombre de columna como lo guarda el importador de la plataforma (minúsculas y guiones bajos). */
export const claveColumna = (c: string) => String(c || "").trim().toLowerCase().replace(/\s+/g, "_");

export interface PlanImportacion {
  filas: { email: string; custom_fields: Record<string, string> }[];
  invalidos: number;
  duplicados: number;
  columnas: string[];
}

/**
 * Filas del adjunto → leads listos para importar: email en minúsculas y válido, sin repetidos
 * dentro del archivo, el resto de columnas (con valor) en custom_fields y con las columnas
 * renombradas a las variables que usan los mensajes.
 */
export function planImportacion(rows: Record<string, unknown>[], renombrar?: Record<string, string> | null, formato: "plantilla" | "todas" = "todas"): PlanImportacion {
  if (formato === "plantilla") rows = aPlantilla(rows);
  const mapa = new Map<string, string>();
  for (const [de, a] of Object.entries(renombrar || {})) {
    if (claveColumna(de) && claveColumna(a) && claveColumna(a) !== "email") mapa.set(claveColumna(de), claveColumna(a));
  }
  const vistos = new Set<string>();
  const columnas = new Set<string>();
  let invalidos = 0, duplicados = 0;
  const filas: PlanImportacion["filas"] = [];
  for (const r of rows || []) {
    if (!r || typeof r !== "object") { invalidos++; continue; }
    const email = String((r as any).email ?? "").trim().toLowerCase().replace(/[,\s]/g, "");
    if (!EMAIL_OK.test(email)) { invalidos++; continue; }
    if (vistos.has(email)) { duplicados++; continue; }
    vistos.add(email);
    const custom_fields: Record<string, string> = {};
    for (const [k, v] of Object.entries(r)) {
      const clave = claveColumna(k);
      if (clave === "email" || v === null || v === undefined) continue;
      const valor = String(v).trim();
      if (!valor) continue;
      const destino = mapa.get(clave) || clave;
      // Si dos columnas acaban con el mismo nombre, gana la que ya tenía valor.
      if (!custom_fields[destino]) custom_fields[destino] = valor;
      columnas.add(destino);
    }
    filas.push({ email, custom_fields });
  }
  return { filas, invalidos, duplicados, columnas: [...columnas].sort() };
}

/** Filas crudas del adjunto → email + columnas de la plantilla (como "Importar con plantilla" en Leads). */
export function aPlantilla(rows: Record<string, unknown>[]): Record<string, string>[] {
  const cab = new Set<string>();
  for (const r of rows.slice(0, 200)) for (const k of Object.keys(r || {})) cab.add(k);
  const filas = rows.map((r) => Object.fromEntries(Object.entries(r || {}).map(([k, v]) => [k, v == null ? "" : String(v)])));
  return filasConPlantilla([...cab], filas);
}

/** De qué columna del CSV sale cada columna de la plantilla (para explicarlo en una línea). */
export function origenPlantilla(rows: Record<string, unknown>[]): Record<string, string | null> {
  const cab = new Set<string>();
  for (const r of rows.slice(0, 200)) for (const k of Object.keys(r || {})) cab.add(k);
  const filas = rows.map((r) => Object.fromEntries(Object.entries(r || {}).map(([k, v]) => [k, v == null ? "" : String(v)])));
  return elegirColumnasPlantilla([...cab], filas, PLANTILLA_COLUMNAS, aliasPlantilla);
}

/* ── Cuentas de correo: salud en lenguaje llano ──────────────────────────────────────── */

export type TipoFallo = "cuenta" | "destinatario" | "temporal" | "otro";

/** Un error SMTP → de quién es la culpa y qué significa, en español llano. */
export function explicarFallo(msg: string | null | undefined): { tipo: TipoFallo; texto: string } | null {
  const m = String(msg || "").trim();
  if (!m) return null;
  const l = m.toLowerCase();
  if (/\b535\b|auth(entication)? failed|authentication credentials|invalid credentials|username and password not accepted|login failed|\b534\b/.test(l)) {
    return { tipo: "cuenta", texto: "El proveedor rechaza la contraseña al enviar (535): hay que revisar o desbloquear el buzón" };
  }
  if (/connection (refused|reset|closed)|timed? ?out|econnrefused|enotfound|getaddrinfo|tls|certificate/.test(l)) {
    return { tipo: "cuenta", texto: "No se puede conectar con el servidor de envío" };
  }
  if (/quota|limit exceeded|too many (messages|recipients)|sending limit|\b452\b|daily user sending/.test(l)) {
    return { tipo: "cuenta", texto: "El proveedor ha frenado el envío por límite o cuota" };
  }
  const codigo = (l.match(/\b([45]\d{2})\b/) || [])[1] || "";
  if (codigo.startsWith("4") || /try again|temporar|greylist/.test(l)) {
    return { tipo: "temporal", texto: "Error temporal del servidor; se reintenta solo" };
  }
  if (codigo.startsWith("55") || /recipient rejected|user unknown|no such user|mailbox (unavailable|not found)|does not exist/.test(l)) {
    return { tipo: "destinatario", texto: "La dirección del lead no existe o no acepta correo (no es culpa de la cuenta)" };
  }
  return { tipo: "otro", texto: m.replace(/\s+/g, " ").slice(0, 140) };
}

export interface CuentaRaw {
  email: string; status: string; last_error: string | null; last_sync: string | null;
  fallidos_24h: number; ultimo_fallo: string | null; ultimo_fallo_at: string | null;
}

/** ¿Está bien esta cuenta? problema = no puede enviar o no sincroniza; aviso = conviene mirarla. */
export function saludCuenta(c: CuentaRaw, now = Date.now()): { estado: "ok" | "aviso" | "problema"; motivo: string } {
  if (c.status && c.status !== "connected") return { estado: "problema", motivo: `Estado "${c.status}": está desconectada` };
  const fallo = explicarFallo(c.ultimo_fallo);
  const recienteMs = c.ultimo_fallo_at ? now - Date.parse(c.ultimo_fallo_at) : Infinity;
  if (c.fallidos_24h > 0 && fallo?.tipo === "cuenta" && recienteMs < 24 * 3600_000) return { estado: "problema", motivo: fallo.texto };
  if (c.last_error && c.last_error.trim()) return { estado: "problema", motivo: `Error al leer el correo: ${c.last_error.trim().slice(0, 120)}` };
  const syncMin = c.last_sync ? (now - Date.parse(c.last_sync)) / 60000 : Infinity;
  if (syncMin > 60) return { estado: "aviso", motivo: c.last_sync ? `No sincroniza el correo desde hace ${Math.round(syncMin / 60)} h` : "Nunca ha sincronizado el correo" };
  if (c.fallidos_24h >= 5 && fallo?.tipo === "temporal") return { estado: "aviso", motivo: `${c.fallidos_24h} fallos temporales en 24 h` };
  return { estado: "ok", motivo: "" };
}

/* ── Etiquetas (tags) de las cuentas ────────────────────────────────────────────────────
   El motor usa en una campaña: las cuentas añadidas a mano (campaign_accounts) ∪ las cuentas
   CONECTADAS cuyas etiquetas coinciden EXACTAMENTE (distingue mayúsculas) con account_tags. */

const normTag = (t: string) => String(t || "").trim().toLowerCase();

/** ¿La cuenta lleva esta etiqueta? (para buscar: sin distinguir mayúsculas ni espacios de más) */
export const tieneTag = (tags: string[] | null | undefined, q: string) => (tags || []).some((t) => normTag(t) === normTag(q));

export interface CampanaTags { name: string; status: string; account_tags: string[] | null }
export interface CuentaTags { email: string; tags: string[]; estado: "ok" | "aviso" | "problema"; status?: string }

export function resumenEtiquetas(cuentas: CuentaTags[], campanas: CampanaTags[]) {
  const porTag = new Map<string, { tag: string; cuentas: number; ok: number; problemas: number }>();
  for (const c of cuentas) {
    for (const t of c.tags || []) {
      const x = porTag.get(t) || { tag: t, cuentas: 0, ok: 0, problemas: 0 };
      x.cuentas++;
      if (c.estado === "ok") x.ok++; else x.problemas++;
      porTag.set(t, x);
    }
  }
  const etiquetas = [...porTag.values()]
    .map((e) => ({ ...e, campanas: campanas.filter((c) => (c.account_tags || []).includes(e.tag)).map((c) => c.name) }))
    .sort((a, b) => b.cuentas - a.cuentas || a.tag.localeCompare(b.tag));

  const avisos: string[] = [];
  for (const camp of campanas) {
    for (const t of camp.account_tags || []) {
      if (porTag.has(t)) continue;
      const parecida = [...porTag.keys()].find((k) => normTag(k) === normTag(t));
      avisos.push(parecida
        ? `"${camp.name}" usa la etiqueta "${t}" pero las cuentas tienen "${parecida}" (cambian las mayúsculas): el motor no las usa.`
        : `"${camp.name}" usa la etiqueta "${t}" y ninguna cuenta la tiene.`);
    }
  }
  const activasPorTag = new Map<string, string[]>();
  for (const camp of campanas.filter((c) => c.status === "active")) {
    for (const t of camp.account_tags || []) activasPorTag.set(t, [...(activasPorTag.get(t) || []), camp.name]);
  }
  for (const [t, nombres] of activasPorTag) {
    if (nombres.length > 1 && porTag.has(t)) {
      avisos.push(`${nombres.map((n) => `"${n}"`).join(" y ")} están activas con la misma etiqueta "${t}": comparten los mismos ${porTag.get(t)!.cuentas} buzones y su límite diario.`);
    }
  }
  return { etiquetas, avisos, sin_etiqueta: cuentas.filter((c) => !(c.tags || []).length).length };
}

/** Categorías del clasificador → cómo se dicen en la plataforma. */
export const VEREDICTO_ES: Record<string, string> = {
  interested: "Interesado", question: "Pregunta", not_interested: "No interesado", no_contactar: "No contactar",
  derivado: "Derivado", out_of_office: "Fuera de oficina", neutral: "Neutral",
};

/** Variables {{x}} que usan unos textos (sin las que rellena el motor). */
export function variablesUsadas(textos: string[]): string[] {
  const motor = new Set(["email", "senderfirstname", "senderlastname", "senderemail"]);
  const out = new Set<string>();
  for (const t of textos) for (const m of String(t || "").matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)) {
    const v = m[1].trim();
    if (!motor.has(v.toLowerCase())) out.add(v);
  }
  return [...out].sort();
}

/** Letra → hueco de la variante (B = 1, C = 2…). null si no es una letra de variante. */
export function slotDeLetra(letra: unknown): number | null {
  const l = String(letra || "").trim().toUpperCase();
  if (!/^[B-Z]$/.test(l)) return null;
  return l.charCodeAt(0) - 64 - 1;
}

export interface VistaVariante { letra: string; encendida: boolean; asunto: string; cuerpo: string }

/** Las variantes (B, C…) de un paso con las MISMAS letras que ve el editor. */
export function variantesDePaso(step: { variants?: unknown; variants_off?: unknown }): VistaVariante[] {
  return versionsOf(readState(step))
    .filter((v: Version) => v.slot > 0 && v.variant)
    .map((v: Version) => ({ letra: v.label, encendida: v.enabled, asunto: v.variant?.subject || "", cuerpo: v.variant?.body || "" }));
}

/** Resultado de una herramienta, recortado para no llenar el contexto del modelo. */
export function paraModelo(valor: unknown, max = 12000): string {
  const t = JSON.stringify(valor);
  return t.length > max ? t.slice(0, max) + `…(recortado, ${t.length - max} caracteres más)` : t;
}

/** Argumentos de una llamada a herramienta; si el modelo manda JSON roto, objeto vacío. */
export function leerArgs(raw: unknown): Record<string, any> {
  if (raw && typeof raw === "object") return raw as Record<string, any>;
  try { const o = JSON.parse(String(raw || "{}")); return o && typeof o === "object" ? o : {}; } catch { return {}; }
}

export const entero = (v: unknown, def: number, min: number, max: number): number => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};

/** Historial guardado → mensajes para el modelo (sólo texto, los últimos N, con tope de tamaño). */
export function historialParaModelo(filas: { role: string; content: string }[], maxMensajes = 24, maxChars = 24000): { role: "user" | "assistant"; content: string }[] {
  const out: { role: "user" | "assistant"; content: string }[] = [];
  let total = 0;
  for (const f of [...filas].reverse()) {
    if (f.role !== "user" && f.role !== "assistant") continue;
    const content = String(f.content || "").slice(0, 4000);
    if (!content.trim()) continue;
    if (out.length >= maxMensajes || total + content.length > maxChars) break;
    out.unshift({ role: f.role, content });
    total += content.length;
  }
  // El modelo espera que la conversación empiece por el usuario.
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}
