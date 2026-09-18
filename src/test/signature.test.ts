import { describe, expect, it } from "vitest";
import { findDataImages, replaceDataImages, decodeBase64Image, isWorthHosting } from "@/lib/signature-images";
import { htmlToPlainText } from "../../supabase/functions/_shared/mime-headers";

// PNG de 1x1 real, en base64.
const PNG_1X1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("imágenes de la firma: alojadas, no incrustadas", () => {
  const firma = `<table><tr><td><img src="data:image/png;base64,${PNG_1X1}" alt="logo" width="46"></td>`
    + `<td><b>John Lopez</b><br><a href="mailto:john@chipsfinder.es">john@chipsfinder.es</a></td></tr></table>`;

  it("encuentra el logo incrustado", () => {
    const imgs = findDataImages(firma);
    expect(imgs).toHaveLength(1);
    expect(imgs[0].mime).toBe("image/png");
    expect(imgs[0].base64).toBe(PNG_1X1);
  });

  it("lo cambia por su enlace y deja el resto intacto", () => {
    const out = replaceDataImages(firma, () => "https://cdn.test/logo.png");
    expect(out).toContain('src="https://cdn.test/logo.png"');
    expect(out).not.toContain("data:image");
    expect(out).toContain('alt="logo"');      // no se toca nada más de la etiqueta
    expect(out).toContain("John Lopez");
  });

  it("si la subida falla, la firma se queda como estaba (nunca se pierde el logo)", () => {
    expect(replaceDataImages(firma, () => null)).toBe(firma);
  });

  it("una firma sin imágenes incrustadas no se toca", () => {
    const sinImg = '<p>Un saludo,<br><b>Ana</b> · <a href="https://onepulso.online">onepulso.online</a></p>';
    expect(findDataImages(sinImg)).toHaveLength(0);
    expect(replaceDataImages(sinImg, () => "https://cdn.test/x.png")).toBe(sinImg);
  });

  it("descifra el base64 y descarta los iconos diminutos", () => {
    const bytes = decodeBase64Image(PNG_1X1)!;
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes[0]).toBe(0x89);              // cabecera PNG
    expect(isWorthHosting(bytes.length)).toBe(false);   // 70 bytes: una viñeta, no un logo
    expect(isWorthHosting(15198)).toBe(true);           // el logo real de chipsfinder
    expect(decodeBase64Image("no-es-base64-válido!!")).toBeNull();
  });
});

describe("la firma en la versión de TEXTO del correo", () => {
  // Firma real (chipsfinder): tabla, logo, correo enlazado con mailto y web.
  const firma = '<table><tbody><tr><td><img src="https://cdn.test/logo.png" alt="CHF"></td>'
    + '<td><div><span>John Lopez</span></div><div><span>Sourcing Specialist&nbsp;·&nbsp;CHF Finder</span></div>'
    + '<div><a href="mailto:john@chipsfinder.es">john@chipsfinder.es</a>&nbsp;·&nbsp;<a href="https://chipsfinder.es">chipsfinder.es</a></div></td></tr></tbody></table>';

  it("se lee como una firma, sin rayas sueltas ni direcciones repetidas", () => {
    const text = htmlToPlainText(firma);
    expect(text).toContain("John Lopez");
    expect(text).toContain("Sourcing Specialist · CHF Finder");
    expect(text).toContain("john@chipsfinder.es");
    expect(text).not.toContain("mailto:");                 // no se le enseña el esquema a nadie
    expect(text).not.toContain("(mailto:john@chipsfinder.es)");
    expect(text.split("\n").some((l) => l.trim() === "|")).toBe(false);  // la celda del logo no deja raya
  });
});
