// Correos "sólo texto" (06-10-2026, petición del dueño: "que los mensajes sean de texto, pero muy
// bien estructurados, y que la función de sólo texto funcione").
//
// Antes, el motor desactivaba el modo sólo texto en cuanto el cuerpo llevaba CUALQUIER etiqueta
// HTML (una negrita <b> bastaba), así que las campañas marcadas "sólo texto" salían en HTML sin
// que nadie lo viera. Y cuando sí entraba en el modo, borraba TODOS los enlaces del texto.
//
// Ahora: un cuerpo con etiquetas se CONVIERTE a texto (negritas fuera, párrafos y saltos
// conservados, cada enlace escrito una vez con su dirección entera) y los enlaces se respetan.
// Sólo se quitan los parámetros de seguimiento (utm_, fbclid, gclid). Todo puro, con pruebas.
import { hasHtmlMarkup, htmlToPlainText } from "./mime-headers.ts";

/** Quita los parámetros de seguimiento de las direcciones, sin tocar el resto del enlace. */
export function stripTrackingParams(text: string): string {
  return String(text || "").replace(/https?:\/\/[^\s<>"')\]]+/gi, (url) => {
    const q = url.indexOf("?");
    if (q < 0) return url;
    const base = url.slice(0, q);
    const [query, hash] = url.slice(q + 1).split("#", 2);
    const kept = query.split("&").filter((p) => p && !/^(utm_[a-z_]+|fbclid|gclid|mc_[a-z]+)=/i.test(p));
    const out = kept.length ? `${base}?${kept.join("&")}` : base;
    return hash !== undefined ? `${out}#${hash}` : out;
  });
}

/**
 * El cuerpo tal como irá en un correo de sólo texto: sin etiquetas, con los párrafos y saltos
 * del autor, los enlaces enteros, sin dobles espacios ni más de una línea en blanco seguida.
 */
export function plainTextBody(body: string | null | undefined): string {
  const raw = String(body || "").replace(/\r\n?/g, "\n");
  let text = hasHtmlMarkup(raw) ? htmlToPlainText(raw) : raw;
  text = stripTrackingParams(text);
  return text
    .replace(/[ \t]+$/gm, "")
    .replace(/^[ \t]+/gm, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
