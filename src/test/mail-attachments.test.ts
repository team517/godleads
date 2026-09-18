import { describe, expect, it } from "vitest";
import { decodeFilename, extractAttachments, looksInline } from "../../supabase/functions/_shared/mail-attachments";

/* El caso real: un correo de MELCOR a dekano decía "Adjuntamos un albarán" y en el Unibox no se
 * veía ningún archivo. El PDF estaba: el lector de adjuntos cortaba el MIME por la PRIMERA
 * frontera que encontraba y, en un correo anidado (mixed → alternative → archivo), esa es la de
 * dentro; el archivo quedaba fuera. Aquí se fija que un correo así entrega su PDF. */

const PDF_B64 = "JVBERi0xLjQKJcOkw7zDtsOfCjIgMCBvYmoKPDwvTGVuZ3RoIDMgMCBSL0ZpbHRlci9GbGF0ZURlY29kZT4+CnN0cmVhbQ==".repeat(3);
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const nested = [
  'Content-Type: multipart/mixed; boundary="----=_OUTER_001"',
  "",
  "------=_OUTER_001",
  'Content-Type: multipart/alternative; boundary="----=_INNER_002"',
  "",
  "------=_INNER_002",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "Buenos días, adjuntamos un albarán de nuestra empresa.",
  "------=_INNER_002",
  "Content-Type: text/html; charset=utf-8",
  "",
  "<p>Buenos d&iacute;as</p>",
  "------=_INNER_002--",
  "",
  "------=_OUTER_001",
  'Content-Type: application/pdf; name="=?UTF-8?Q?Albar=C3=A1n.pdf?="',
  "Content-Transfer-Encoding: base64",
  'Content-Disposition: attachment; filename="=?UTF-8?Q?Albar=C3=A1n.pdf?="',
  "",
  PDF_B64,
  "------=_OUTER_001--",
  "",
].join("\r\n");

describe("adjuntos de un correo anidado", () => {
  const found = extractAttachments(nested);

  it("encuentra el PDF aunque vaya detrás de una parte multiparte", () => {
    expect(found).toHaveLength(1);
    expect(found[0].name).toBe("Albarán.pdf");
    expect(found[0].mime).toBe("application/pdf");
    expect(found[0].size).toBeGreaterThan(100);
    expect(found[0].base64.length).toBeGreaterThan(40);
  });

  it("el texto del correo no se cuela como archivo", () => {
    expect(found.some((a) => a.mime.startsWith("text/"))).toBe(false);
  });

  it("un archivo enorme se anota por su nombre, sin bajarlo", () => {
    const big = extractAttachments(nested, { maxBytes: 10 });
    expect(big[0]).toMatchObject({ name: "Albarán.pdf", oversized: true, base64: "" });
  });
});

describe("el logo de una firma no es un archivo adjunto", () => {
  const conLogo = [
    "------=_X_1",
    'Content-Type: image/png; name="logo.png"',
    "Content-Transfer-Encoding: base64",
    "Content-Disposition: inline; filename=\"logo.png\"",
    "",
    PNG_B64,
    "------=_X_1--",
  ].join("\r\n");

  it("se distingue por ser una imagen diminuta", () => {
    const [logo] = extractAttachments(conLogo);
    expect(logo?.mime).toBe("image/png");
    expect(looksInline(logo)).toBe(true);
  });
});

describe("nombres de archivo", () => {
  it("entiende el formato con acentos (RFC 2047)", () => {
    expect(decodeFilename("=?UTF-8?B?QWxiYXLDoW4ucGRm?=")).toBe("Albarán.pdf");
    expect(decodeFilename("=?UTF-8?Q?Factura_marzo.pdf?=")).toBe("Factura marzo.pdf");
  });
  it("y el otro formato con acentos (RFC 2231)", () => {
    expect(decodeFilename("utf-8''Albar%C3%A1n%20de%20obra.pdf")).toBe("Albarán de obra.pdf");
  });
  it("un nombre normal se queda igual", () => {
    expect(decodeFilename('"contrato.pdf"')).toBe("contrato.pdf");
  });
});

describe("correos sin adjuntos", () => {
  it("no inventa nada", () => {
    expect(extractAttachments("")).toEqual([]);
    expect(extractAttachments("Hola, ¿hablamos mañana?")).toEqual([]);
  });
});
