import { describe, expect, it } from "vitest";
import { cleanBody, decodeCp1252, extractHtml, reinterpretBytes } from "../../supabase/functions/_shared/imap-parse";
import { repairMojibakeBytes } from "../../supabase/functions/_shared/reply-text";

/* Correos de Outlook en Windows-1252 (GMV → Chipsfinder, 22-10-2026): "Monitor 7” VGA" se guardaba
   como "Monitor 7 VGA". El socket IMAP se lee como windows-1252 y al reinterpretar los bytes la "”"
   (U+201D) se convertía en 0x1D, un control que la limpieza borraba. */

/** Lo que entrega el socket: los bytes del correo leídos como windows-1252. */
function socket(parts: (string | number[])[]): string {
  const bytes: number[] = [];
  for (const p of parts) {
    if (typeof p === "string") for (const ch of p) bytes.push(ch.charCodeAt(0));
    else bytes.push(...p);
  }
  return decodeCp1252(new Uint8Array(bytes));
}

const RDQ = [0x94]; // ” en Windows-1252
const LDQ = [0x93]; // “
const EURO = [0x80]; // €
const E_ACUTE = [0xe9]; // é

function outlook8bit(): string {
  return socket([
    "--_000_GVX_\r\nContent-Type: text/plain; charset=\"Windows-1252\"\r\nContent-Transfer-Encoding: 8bit\r\n\r\n",
    "Could you please send me a quote for 4 pcs of P018761 - Monitor 7", RDQ, " VGA 9-36Vdc (INELMATIC:OF700HB-RN-1872)? Caf", E_ACUTE, " ", LDQ, "-I", RDQ, " 60", EURO, "/pc\r\n\r\n",
    "--_000_GVX_\r\nContent-Type: text/html; charset=\"Windows-1252\"\r\nContent-Transfer-Encoding: 8bit\r\n\r\n",
    "<html><body><p>Monitor 7", RDQ, " VGA 9-36Vdc (INELMATIC:OF700HB-RN-1872) Caf", E_ACUTE, " ", LDQ, "-I", RDQ, " 60", EURO, "/pc</p></body></html>\r\n",
    "--_000_GVX_--\r\n",
  ]);
}

describe("Outlook en Windows-1252", () => {
  it("el HTML conserva comillas tipográficas, € y tildes (8 bits)", () => {
    const html = extractHtml(outlook8bit());
    expect(html).toContain("Monitor 7” VGA 9-36Vdc (INELMATIC:OF700HB-RN-1872)");
    expect(html).toContain("Café “-I” 60€/pc");
  });

  it("el texto también", () => {
    const text = cleanBody(outlook8bit());
    expect(text).toContain("P018761 - Monitor 7” VGA 9-36Vdc (INELMATIC:OF700HB-RN-1872)?");
    expect(text).toContain("Café “-I” 60€/pc");
  });

  it("igual en quoted-printable", () => {
    const raw = [
      "--_000_GVX_", 'Content-Type: text/html; charset="Windows-1252"', "Content-Transfer-Encoding: quoted-printable", "",
      "<p>Monitor 7=94 VGA =93-I=94 60=80/pc Caf=E9</p>", "", "--_000_GVX_--", ""].join("\r\n");
    expect(extractHtml(raw)).toContain("Monitor 7” VGA “-I” 60€/pc Café");
  });

  it("reinterpretar es el inverso exacto de leer el socket", () => {
    const all = new Uint8Array(256).map((_, i) => i);
    expect(reinterpretBytes(decodeCp1252(all), "windows-1252")).toBe(decodeCp1252(all));
    // y con otro juego de caracteres se recuperan los bytes de verdad: ISO-8859-15 0xA4 = €
    expect(reinterpretBytes(decodeCp1252(new Uint8Array([0xa4])), "iso-8859-15")).toBe("€");
  });

  it("los correos en UTF-8 de 8 bits siguen bien (como en fetch-inbox: cleanBody + repairMojibakeBytes)", () => {
    const utf8 = Array.from(new TextEncoder().encode("Monitor 7” VGA · gustaría · TS512MSK64V6N-I −40°C"));
    const raw = socket(["--b1234567890\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n", utf8, "\r\n--b1234567890--\r\n"]);
    expect(repairMojibakeBytes(cleanBody(raw))).toContain("Monitor 7” VGA · gustaría · TS512MSK64V6N-I −40°C");
  });
});
