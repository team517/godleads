// Reenviar un correo desde el Unibox: el asunto y el cuerpo que se mandan.
//
// Puro (sin React ni red) para poder probarlo: es lo que decide que un reenvío se vea como un
// reenvío de verdad —cabecera "De / Fecha / Asunto / Para" como la de Gmail, tu nota arriba y el
// original ENTERO debajo con su estructura— y no como un bloque de texto todo junto.

export interface ForwardSource {
  fromName?: string | null;
  fromEmail: string;
  /** Fecha ya formateada para la persona ("18/9/2026, 12:00:52"). */
  when: string;
  /** Asunto del original, ya descodificado. */
  subject: string;
  /** Buzón nuestro que lo recibió (el "Para" de la cabecera). */
  toAccountEmail?: string | null;
  /** El original listo para pintar: HTML limpio, o texto plano ya escapado en un <div>. */
  originalHtml: string;
}

export const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** "Fwd: X". Nunca "Fwd: Fwd: X"; sin asunto → "Fwd: (sin asunto)". */
export function forwardSubject(original: string | null | undefined): string {
  const s = String(original || "").trim();
  if (!s) return "Fwd: (sin asunto)";
  return /^\s*(fwd?|rv|tr|wg)\s*:/i.test(s) ? s : `Fwd: ${s}`;
}

/** Un texto plano como HTML que respeta sus saltos de línea. */
export function plainToForwardHtml(text: string | null | undefined): string {
  return `<div style="white-space:pre-wrap">${esc(text || "")}</div>`;
}

/** El cuerpo del reenvío: nota (si la hay) + cabecera + original. */
export function buildForwardHtml(src: ForwardSource, note: string): string {
  const from = `${src.fromName ? `${src.fromName} ` : ""}<${src.fromEmail}>`;
  const cabecera = [
    ["De", from],
    ["Fecha", src.when],
    ["Asunto", src.subject],
    ["Para", src.toAccountEmail || ""],
  ]
    .filter(([, v]) => String(v || "").trim())
    .map(([k, v]) => `<b>${k}:</b> ${esc(v)}`)
    .join("<br>");

  const nota = note.trim() ? `<div style="white-space:pre-wrap">${esc(note.trim())}</div><br>` : "";

  // El original va dentro de un <div>, NUNCA de un <p>: un párrafo no puede contener otros
  // párrafos, listas ni tablas, y el cliente de correo lo cierra por su cuenta dejando el correo
  // "todo junto".
  return (
    nota +
    `<div style="border-top:1px solid #d9d9d9;padding-top:12px;margin-top:8px">` +
    `<div style="font-size:13px;color:#5f6368;margin-bottom:10px">---------- Mensaje reenviado ----------<br>${cabecera}</div>` +
    `<div>${src.originalHtml}</div>` +
    `</div>`
  );
}
