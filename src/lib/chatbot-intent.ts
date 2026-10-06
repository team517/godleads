// ¿Lo que escribe el usuario en el chatbot flotante es una petición de CAMBIAR algo en sus
// campañas (mensajes, asuntos, esperas, variantes, crear una campaña…)? Entonces el turno va a
// PulseBot (ia-modificaciones en modo propio), que ve la cuenta y aplica el cambio con tarjeta de
// antes/después y Confirmar/Deshacer. El resto sigue con el consultor de siempre.

const VERBOS = /\b(cambia|cambiar|cámbiame|cambiame|modifica|modificar|modifícame|edita|editar|edítame|actualiza|actualizar|sustituye|sustituir|reemplaza|reemplazar|reescribe|reescribir|corrige|corregir|arregla|arreglar|pon|ponle|ponme|poner|quita|quítale|quitar|borra|borrar|elimina|eliminar|añade|añadir|agrega|agregar|mete|meter|crea|crear|créame|genera|generar|acorta|alarga|mejora|mejorar|traduce|traducir|aplica|aplicar|aplícalo|ajusta|ajustar|programa|programar|configura|configurar)\b/i;
const OBJETOS = /\b(campa[ñn]as?|mensajes?|pasos?|asuntos?|follow[- ]?ups?|seguimientos?|secuencias?|variantes?|esperas?|d[ií]as? de espera|correos? de (la |mi )?campa[ñn]a|emails? de (la |mi )?campa[ñn]a|primer (correo|email|mensaje)|segundo (correo|email|mensaje)|tercer (correo|email|mensaje)|firma|enlace de reserva|calendly|cuerpo|texto del (correo|mensaje|email)|leads? a (la |mi )?campa[ñn]a)\b/i;
// "en mi campaña X", "de la campaña X": también es cambio aunque el verbo esté implícito.
const CAMPANA_NOMBRADA = /\b(en|de|a) (mi |la |nuestra )?campa[ñn]a\b/i;
// Lo que NUNCA es un cambio aunque lleve esas palabras: análisis, consejo, dudas.
const SOLO_CONSEJO = /\b(anal[ií]za|analizar|gr[aá]fic[oa]s?|m[eé]tricas?|estad[ií]sticas?|rendimiento|c[oó]mo (mejoro|puedo|hago|funciona)|qu[eé] (opinas|te parece|es|significa)|por qu[eé]|expl[ií]came|consejos?|ideas? para|recomi[eé]nda)\b/i;

export function esPeticionDeCambio(texto: string): boolean {
  const t = String(texto || "").trim();
  if (t.length < 4) return false;
  if (SOLO_CONSEJO.test(t) && !/\b(aplica|aplícalo|cámbialo|cambialo|hazlo|ponlo)\b/i.test(t)) return false;
  if (!VERBOS.test(t)) return false;
  return OBJETOS.test(t) || CAMPANA_NOMBRADA.test(t);
}

/**
 * Cuando el turno anterior ya lo llevó PulseBot (hay una tarjeta o una pregunta suya), una
 * respuesta corta del usuario ("sí", "aplícalo", "el segundo", "hazlo", "cambia el asunto") sigue
 * con PulseBot: si no, la confirmación acabaría en el consultor, que no puede aplicar nada.
 */
const CONTINUA = /\b(s[ií]|vale|ok|okey|dale|hazlo|aplica|apl[ií]calo|confirma|conf[ií]rmalo|adelante|perfecto|ese|esa|el (primero|segundo|tercero|cuarto)|la (primera|segunda|tercera)|no|mejor|otro|otra|cambia|cámbialo|quita|pon|deja|as[ií])\b/i;
export function siguePulseBot(texto: string, anteriorFuePulseBot: boolean): boolean {
  if (!anteriorFuePulseBot) return false;
  const t = String(texto || "").trim();
  if (!t) return false;
  if (esPeticionDeCambio(t)) return true;
  if (SOLO_CONSEJO.test(t) && t.length > 40) return false;
  return t.length <= 160 && CONTINUA.test(t);
}

/**
 * "Aplícalo", "hazlo", "sí, aplica el cambio": una orden CORTA de aplicar. Siempre va a PulseBot, venga el turno anterior
 * de quien venga: el consultor no puede tocar campañas y decía "hecho" sin hacer nada (06-10-2026). Si lo anterior fue
 * el consultor proponiendo un cambio, PulseBot recibe esa conversación como contexto y lo aplica de verdad.
 */
const ORDEN_APLICAR = /\b(apl[ií]c(a|alo|ala|alos|alas|ame)|aplicar(lo|la)?|h[aá]zlo|hazla|dale|confirma(lo)?|conf[ií]rma(lo)?|procede|proc[eé]delo|ejec[uú]talo|gu[aá]rdalo)\b/i;
export function esOrdenDeAplicar(texto: string): boolean {
  const t = String(texto || "").trim();
  if (!t || t.length > 60) return false;
  return ORDEN_APLICAR.test(t) && !/\bno\b/i.test(t);
}

/** Los últimos mensajes del consultor, como contexto de un solo uso para PulseBot. */
export function contextoParaPulseBot(mensajes: { role: string; content: string }[], max = 6): string {
  const ultimos = mensajes.filter((m) => (m.role === "user" || m.role === "assistant") && m.content && m.content.trim()).slice(-max);
  if (ultimos.length === 0) return "";
  return ultimos.map((m) => `${m.role === "user" ? "Usuario" : "Consultor"}: ${m.content.replace(/\s+/g, " ").trim().slice(0, 400)}`).join("\n");
}
