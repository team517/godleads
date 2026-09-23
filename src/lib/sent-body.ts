import DOMPurify from "dompurify";
import { hasHtmlMarkup, textToHtmlBody } from "@/lib/mime-headers";

/**
 * HTML para ENSEÑAR el cuerpo de un correo que hemos enviado.
 *
 * Las campañas "solo texto" guardan (y mandan) el cuerpo como texto con líneas en blanco entre
 * párrafos. Al destinatario le llega bien, porque va como text/plain y el cliente respeta los
 * saltos. Pero al pintarlo en la plataforma con innerHTML, el HTML se come los saltos y el correo
 * se veía como un ladrillo de texto seguido (23-09-2026: los seguimientos de CHIPSFINDER).
 *
 * Por eso: si el cuerpo trae HTML, se limpia y se pinta; si es texto, se convierte antes a
 * párrafos de verdad (textToHtmlBody también escapa &, < y >, así que un "<2 horas" no se come
 * media frase).
 */
export function sentBodyHtml(body: string | null | undefined): string {
  const raw = String(body || "");
  if (!raw.trim()) return "";
  return DOMPurify.sanitize(hasHtmlMarkup(raw) ? raw : textToHtmlBody(raw));
}
