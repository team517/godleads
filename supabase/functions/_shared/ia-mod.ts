// "Modificaciones IA": instrucciones, herramientas y utilidades puras del chat del equipo.
// Sin imports de Deno ni de red, para poder probarlo con vitest.
import { CAMPAIGN_COPY_SYSTEM } from "./campaign-copy.ts";
import { FORMATO_TEXTO_PLANO } from "./sequence-copy.ts";
import { readState, versionsOf, type Version } from "./step-variants.ts";

/** Sólo estas cuentas pueden usar el chat (el propietario pidió: equipo, hello y support). */
export const IA_MOD_EMAILS = ["hello@onepulso.blog", "support@onepulso.online", "equipo@onepulso.online"];
export const puedeUsarIaMod = (email: string | null | undefined) => IA_MOD_EMAILS.includes(String(email || "").trim().toLowerCase());

/** Herramientas que cambian algo en la cuenta del cliente. */
export const ESCRITURAS = new Set([
  "crear_mensaje", "editar_mensaje", "eliminar_mensaje", "crear_variante", "editar_variante", "eliminar_variante", "crear_campana",
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
  fn("leer_web", "Lee el texto de una web pública (la del cliente, para entender qué vende).", { url: S("dominio o URL") }, ["url"]),
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

QUÉ PUEDES HACER: ver sus campañas, sus mensajes, sus métricas y sus respuestas; leer su web; guardar notas en su memoria; crear, editar y borrar mensajes y variantes; crear campañas nuevas en borrador. NO puedes activar ni pausar campañas, ni tocar leads, cuentas de correo ni ajustes: si te lo piden, di que eso se hace desde su panel.

CÓMO TRABAJAS:
1. Nunca inventes datos: para hablar de campañas, mensajes, métricas o respuestas, llama antes a la herramienta. Los números salen SIEMPRE de las herramientas.
2. Antes de cambiar un mensaje, míralo con ver_mensajes. Antes de escribir mensajes nuevos, entiende al cliente: su memoria, sus mensajes actuales, sus respuestas y, si hace falta, su web (dominio de su correo o de sus mensajes). Si falta algo esencial (qué vende, su dato de resultado, qué demo puede enseñar), pregúntalo antes de escribir.
3. Si el usuario te pide un cambio claro, HAZLO con la herramienta (no te limites a proponerlo) y luego resume en 1-3 líneas qué has cambiado. Los cambios se pueden deshacer con un botón.
4. Borrar un mensaje o una variante, o meter un mensaje en medio de la secuencia, queda PENDIENTE: dile al usuario que pulse "Confirmar" en la tarjeta.
5. Si la campaña está ACTIVA, avisa de que el cambio se aplica a los próximos envíos. Si añades un mensaje al final, los leads que ya terminaron la secuencia no lo recibirán.
6. Para métricas llama a "metricas": la imagen con la gráfica sale sola; tú comenta en 2-4 líneas lo importante (tasa de respuesta = respuestas / contactados) y da un consejo concreto.
7. Guarda con guardar_nota los datos del cliente que el equipo te cuente y que habrá que recordar.
8. Responde breve y con formato limpio (markdown sencillo). No pegues los mensajes enteros en el texto si ya los enseña una tarjeta.

CÓMO SE ESCRIBEN LOS MENSAJES (obligatorio en todo lo que crees o edites): se calcan de los EJEMPLOS QUE FUNCIONAN. Cada posición calca su ejemplo: posición 1 = STEP 1, posición 2 = STEP 2, posición 3 o más = STEP 3. Cambia sólo lo que es del cliente (oferta, método, dato, demo, firma y enlace de reserva si lo tiene). Esperas: 0 en el primero, 2 días en el segundo, 3 en los siguientes. Los follow-ups van en el mismo hilo: su asunto va vacío.
FIRMA: si los mensajes actuales del cliente firman con un nombre, usa ese mismo. Si no hay ninguno, usa {{SenderFirstName}} (el motor pone el nombre de cada buzón que envía).
VARIANTES: una variante cambia sólo el ángulo de la frase de oferta y del dato; el molde, las frases-ancla y la pregunta final no cambian.

${CAMPAIGN_COPY_SYSTEM}

${FORMATO_TEXTO_PLANO}`;
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
