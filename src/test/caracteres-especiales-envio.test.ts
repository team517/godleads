import { describe, expect, it } from "vitest";
import { quotedPrintableEncode } from "../../supabase/functions/_shared/smtp";
import { htmlToPlainText, textToHtmlBody } from "../../supabase/functions/_shared/mime-headers";

/* ¿Llega entero un código de pieza con caracteres especiales? (21-10-2026, respuesta a un cliente
   de Chipsfinder): “-I”, TS512MSK64V6N-I, −40°C to +85°C. */

function qpDecode(s: string): string {
  const soft = s.replace(/=\r\n/g, "");
  const bytes: number[] = [];
  for (let i = 0; i < soft.length; i++) {
    if (soft[i] === "=" && /^[0-9A-F]{2}$/.test(soft.slice(i + 1, i + 3))) { bytes.push(parseInt(soft.slice(i + 1, i + 3), 16)); i += 2; }
    else bytes.push(soft.charCodeAt(i));
  }
  return new TextDecoder("utf-8").decode(new Uint8Array(bytes));
}

const TEXTO = "Thank you for your reply. We understand that you require the industrial version with the “-I” suffix.\n\n" +
  "Could you please confirm whether TS512MSK64V6N-I is the correct full part number? This module supports an operating temperature range of −40°C to +85°C.\n\n" +
  "We have located a supplier that lists this reference and would like to confirm it matches your requirement.";

describe("Envío con códigos y símbolos", () => {
  it("la parte HTML llega idéntica (código, comillas, menos tipográfico y grados)", () => {
    const html = textToHtmlBody(TEXTO);
    const roundTrip = qpDecode(quotedPrintableEncode(html));
    expect(roundTrip).toBe(html);
    for (const s of ["TS512MSK64V6N-I", "“-I”", "−40°C to +85°C"]) expect(roundTrip).toContain(s);
  });

  it("la parte de texto plano también", () => {
    const plain = htmlToPlainText(textToHtmlBody(TEXTO));
    // En MIME los saltos de línea viajan como CRLF (lo exige el estándar); el programa de correo
    // los muestra como saltos normales. Se compara el texto, no el tipo de salto.
    const sinCR = (s: string) => s.split(String.fromCharCode(13)).join("");
    const roundTrip = sinCR(qpDecode(quotedPrintableEncode(plain)));
    expect(roundTrip).toBe(sinCR(plain));
    for (const s of ["TS512MSK64V6N-I", "“-I”", "−40°C to +85°C"]) expect(roundTrip).toContain(s);
  });

  it("también si el editor lo manda como HTML con entidades", () => {
    const html = "<p>Could you please confirm whether <b>TS512MSK64V6N-I</b> is correct? Range &minus;40&deg;C to +85&deg;C, suffix &ldquo;-I&rdquo; &#8722;40&#176;C</p>";
    const plain = htmlToPlainText(html);
    expect(qpDecode(quotedPrintableEncode(plain))).toBe(plain);
    expect(plain).toContain("TS512MSK64V6N-I");
    expect(plain).toContain("Range −40°C to +85°C, suffix “-I” −40°C");
    expect(htmlToPlainText("<p>Se&ntilde;ora Garc&iacute;a, &amp;deg; literal</p>")).toBe("Señora García, &deg; literal");
  });

  it("ninguna línea codificada pasa de 76 caracteres (si no, algunos servidores la cortan)", () => {
    const qp = quotedPrintableEncode(textToHtmlBody(TEXTO.repeat(5)));
    for (const line of qp.split("\r\n")) expect(line.length).toBeLessThanOrEqual(76);
  });
});
