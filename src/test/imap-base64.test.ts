import { describe, expect, it } from "vitest";
import { base64ToBytesLenient, cleanBody, extractHtml, parseInboundItem, splitFetchItems } from "../../supabase/functions/_shared/imap-parse";

/* Cuerpos en base64 que se guardaban SIN decodificar (05-10-2026): ~1.100 correos al día desde el
   02-10. Quitar "=" + salto (el salto blando de quoted-printable) se comía el relleno del base64,
   atob() fallaba y el detector de warm-up no podía leer el texto ("Darcy Birt", en Campañas). */

const CRLF = "\r\n";
const wire = (s: string) => Array.from(new TextEncoder().encode(s), (b) => String.fromCharCode(b)).join("");
const b64 = (s: string) => btoa(wire(s)).replace(/(.{76})/g, "$1\r\n");

function parse(headers: string[], body: string) {
  const header = headers.join(CRLF) + CRLF + CRLF;
  const item = `* 1 FETCH (UID 7 INTERNALDATE "05-Oct-2026 13:25:00 +0200" BODY[HEADER.FIELDS (FROM TO SUBJECT)] {${header.length}}${CRLF}${header} BODY[TEXT]<0> {${body.length}}${CRLF}${body})${CRLF}`;
  const { items } = splitFetchItems(item + `A1 OK Fetch completed.${CRLF}`);
  const p = parseInboundItem(items[0], { accountEmail: "juan@kingofleadone.com", imapUsername: "juan@kingofleadone.com" });
  if (p.status !== "message") throw new Error(JSON.stringify(p));
  return p.msg;
}

const H = (cte = "base64") => [
  "From: Darcy Birt <darcy.birt@acivleverage.co>",
  "To: juan@kingofleadone.com",
  "Subject: RE: Welcome to the Team!",
  "Message-ID: <x1@acivleverage.co>",
  "Content-Type: text/plain; charset=utf-8",
  `Content-Transfer-Encoding: ${cte}`,
];

describe("base64 tolerante", () => {
  it("rehace el relleno y descarta un grupo incompleto", () => {
    const dec = (s: string) => new TextDecoder().decode(base64ToBytesLenient(s));
    expect(dec("SG9sYQ==")).toBe("Hola");
    expect(dec("SG9sYQ=")).toBe("Hola");      // un "=" perdido
    expect(dec("SG9sYQ")).toBe("Hola");       // sin relleno
    expect(dec("SG9s\r\nYQ==\r\n")).toBe("Hola");
    expect(dec("SG9sYSBh")).toBe("Hola a");
    expect(dec("SG9sYSBhb")).toBe("Hola a");  // cortado a media (FETCH parcial)
  });
});

describe("cuerpo de una sola parte en base64", () => {
  const texto = "Thank you for guide-share the warm welcome! Excited to start working with everyone.\r\n";

  it("con relleno '==' al final de una línea", () => {
    const body = b64(texto) + CRLF;
    expect(btoa(wire(texto)).endsWith("==")).toBe(true);
    const m = parse(H(), body);
    expect(m.body_text).toBe("Thank you for guide-share the warm welcome! Excited to start working with everyone.");
  });

  it("cortado por el FETCH parcial", () => {
    const largo = "Hola Juan, me interesa mucho la propuesta. ¿Podemos hablar el martes a las diez? ".repeat(20);
    const body = b64(largo).slice(0, 301);
    const m = parse(H(), body);
    expect(m.body_text.startsWith("Hola Juan, me interesa mucho la propuesta.")).toBe(true);
  });

  it("quoted-printable sigue uniendo los saltos blandos", () => {
    const body = "Hola, esto es una l=C3=ADnea muy larga que el servidor parte en dos con un salto bl=\r\nando.\r\n";
    const m = parse(H("quoted-printable"), body);
    expect(m.body_text).toBe("Hola, esto es una línea muy larga que el servidor parte en dos con un salto blando.");
  });

  it("el último recurso (sin cabecera) también decodifica con un '=' perdido", () => {
    const blob = btoa(wire("Perfecto, me interesa. Llámame mañana.")).replace(/=+$/, "=");
    expect(cleanBody(blob)).toBe("Perfecto, me interesa. Llámame mañana.");
  });

  it("HTML en base64 dentro de multipart", () => {
    const html = "<p>Hola <b>Juan</b></p>";
    const raw = "--bnd1234567890\r\nContent-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" + b64(html) + "\r\n--bnd1234567890--\r\n";
    expect(extractHtml(raw)).toBe(html);
  });
});
