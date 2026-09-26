// "Generar con IA" / "Escribir con IA" del editor de secuencias: el prompt y la limpieza de la
// respuesta. Parte pura (sin imports de Deno) para poder probarla con vitest.
//
// Antes este generador tenía un prompt propio y genérico ("3-5 líneas máximo") y los correos no
// se parecían en nada a los EJEMPLOS QUE FUNCIONAN. Ahora calca el mismo molde que el bot de
// support y "Crear campaña" (_shared/campaign-copy.ts), con dos diferencias propias del editor:
//   · el editor es un cuadro de TEXTO: los párrafos van separados por una línea en blanco, sin
//     HTML (el motor ya lo convierte en párrafos al enviar);
//   · quien firma es la persona de cada buzón que envía ({{SenderFirstName}}, lo rellena el
//     motor por cuenta), salvo que el usuario diga un nombre.
import { CAMPAIGN_COPY_SYSTEM } from "./campaign-copy.ts";

export const MAX_STEPS = 6;

/** Qué ejemplo del molde calca el correo que va en esa posición (1 = el inicial). */
export function ejemploParaPaso(posicion: number): string {
  if (posicion <= 1) return "STEP 1 (email inicial)";
  if (posicion === 2) return "STEP 2 (primer follow-up)";
  return "STEP 3 (segundo follow-up)";
}

/** Los follow-ups van en el hilo del primero: su asunto queda vacío (el editor y el motor usan
 *  "Re: <asunto del primero>"). */
export function asuntoParaPaso(posicion: number, asunto: string): string {
  return posicion <= 1 ? asunto : "";
}

/** Días de espera antes de cada correo, como el molde: el primero sale ya, el primer follow-up a
 *  los 2 días y los siguientes a los 3. */
export function esperaParaPaso(posicion: number): number {
  if (posicion <= 1) return 0;
  return posicion === 2 ? 2 : 3;
}

export interface OpcionesSecuencia {
  variables: string[];
  /** Nombre de quien firma, si el usuario lo ha dado. Si no, {{SenderFirstName}}. */
  firma?: string | null;
}

export function sistemaSecuencia(o: OpcionesSecuencia): string {
  const vars = o.variables.map((v) => `{{${v}}}`).join(", ") || "(ninguna)";
  const firma = (o.firma || "").trim();
  const quien = firma
    ? `Firma y preséntate como "${firma}" ("Soy ${firma}, ..." y "${firma}" al final).`
    : `No sabes cómo se llama quien envía: la campaña sale desde varios buzones, cada uno con su persona. Donde el ejemplo dice "Mario" escribe EXACTAMENTE {{SenderFirstName}} ("Soy {{SenderFirstName}}, Investigando ..." y {{SenderFirstName}} como firma). Si el CONTEXTO da el nombre de la persona que firma, usa ese nombre en su lugar.`;
  return `Eres el copywriter de cold email de una plataforma de envío en frío. Escribes, en español, los correos de la secuencia de UNA campaña del usuario, para vender lo que el usuario vende (según su CONTEXTO). No menciones ninguna agencia ni "TuNuevoLead": eso es sólo el ejemplo.

MOLDE (obligatorio): los EJEMPLOS QUE FUNCIONAN y sus reglas van a continuación. Cada correo se calca del ejemplo de su step; sólo cambia lo que es del usuario (oferta, método, dato, demo, firma y enlace de reserva si lo da).

${CAMPAIGN_COPY_SYSTEM}

QUIÉN FIRMA: ${quien}

VARIABLES DISPONIBLES en los leads de esta campaña: ${vars}. Usa {{first_name}} y {{company_name}} donde las usa el ejemplo. Si en la lista la del nombre de pila o la de la empresa se llama distinto (p. ej. {{nombre}}, {{empresa}}, {{organization_name}}), usa la de la lista. Si la lista está vacía, usa {{first_name}} y {{company_name}} como el ejemplo. No inventes otras variables.

ASUNTO (cada correo lleva uno, nunca vacío): 3-6 palabras, minúscula inicial, con {{company_name}} o {{first_name}}, sin emojis ni exclamaciones. Estilo: "idea para {{company_name}}", "{{first_name}}, una propuesta", "caso real para {{company_name}}". Los follow-ups (posición 2 en adelante) van en el MISMO hilo que el primero ("Re: ..."), como en el ejemplo: su "subject" va VACÍO ("").

FORMATO DE SALIDA (manda sobre el "FORMATO" del molde): el cuerpo es TEXTO PLANO para un cuadro de texto. Nada de HTML (<p>, <br>, <strong>). Cada párrafo del ejemplo, separado del siguiente por UNA línea en blanco. La despedida ("quedo atento" / "un saludo" / nombre) va en líneas seguidas, sin línea en blanco entre ellas.

Responde EXCLUSIVAMENTE con un JSON array (sin markdown ni backticks):
[{"subject":"...","body":"..."}]`;
}

/** El mensaje del usuario: el contexto y qué correos escribir. */
export function peticionSecuencia(contexto: string, pasos: number, posicionUnica?: number | null): string {
  const cuales = posicionUnica
    ? `Escribe SOLO UN correo: el que va en la posición ${posicionUnica} de la secuencia. Cálcalo del ejemplo ${ejemploParaPaso(posicionUnica)}. Devuelve un array con un único elemento.`
    : `Escribe ${pasos} correo(s) en orden: ${Array.from({ length: pasos }, (_, i) => `${i + 1}) calca el ejemplo ${ejemploParaPaso(i + 1)}`).join("; ")}. Devuelve un array con ${pasos} elementos.`;
  return `CONTEXTO DEL USUARIO (lo que vende, a quién, su dato de resultado, su demo, su enlace de reserva si lo tiene, quién firma):\n${contexto || "(sin contexto)"}\n\n${cuales}`;
}

/** Deja el cuerpo como texto con párrafos separados por una línea en blanco, aunque el modelo
 *  haya devuelto HTML o haya pegado los párrafos. */
export function cuerpoATexto(body: string): string {
  let t = String(body || "").replace(/\r\n?/g, "\n");
  if (/<\/?(p|br|div|strong|b|em|i|span)\b/i.test(t)) {
    t = t
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div)>\s*/gi, "\n\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }
  return t
    .split("\n").map((l) => l.replace(/[ \t]+$/g, "").replace(/^[ \t]+/g, "")).join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Lee la respuesta del modelo: acepta el array suelto, dentro de ```json o dentro de {steps:[…]}. */
export function leerPasos(contenido: string): { subject: string; body: string }[] {
  const limpio = String(contenido || "").replace(/```json\s*/gi, "").replace(/```/g, "").trim();
  const inicio = limpio.search(/[\[{]/);
  if (inicio < 0) throw new Error("respuesta sin JSON");
  const datos = JSON.parse(limpio.slice(inicio, Math.max(limpio.lastIndexOf("]"), limpio.lastIndexOf("}")) + 1));
  const lista = Array.isArray(datos) ? datos : Array.isArray(datos?.steps) ? datos.steps : [datos];
  return lista
    .filter((s: any) => s && typeof s === "object")
    .map((s: any) => ({ subject: String(s.subject || "").trim(), body: cuerpoATexto(String(s.body || "")) }))
    .filter((s: { body: string }) => s.body.length > 0);
}
