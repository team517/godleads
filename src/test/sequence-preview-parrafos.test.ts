import { describe, expect, it } from "vitest";
import { textToHtmlBody, htmlToPlainText } from "@/lib/mime-headers";

// La vista previa de Campañas pinta el cuerpo con textToHtmlBody: da igual cómo esté guardado,
// tiene que salir en párrafos. Antes se pintaba tal cual con whitespace-pre-wrap y un cuerpo
// guardado con <p> se veía todo junto (24-09-2026).
const TEXTO = `Buenas Javier

Soy Oliver, te escribo porque ayudamos a empresas como la tuya.

¿te va bien verlo 10 minutos esta semana?

un saludo
Oliver
Libertis`;

const HTML = `<p>Buenas Javier</p><p>Soy Oliver, te escribo porque ayudamos a empresas como la tuya.</p><p>un saludo<br>Oliver</p>`;

describe("vista previa de la secuencia", () => {
  it("un cuerpo de texto con líneas en blanco sale en párrafos", () => {
    const html = textToHtmlBody(TEXTO);
    expect((html.match(/<p[ >]/g) || []).length).toBe(4);
    expect(html).toContain("un saludo<br>Oliver<br>Libertis");
  });
  it("un cuerpo que ya viene en HTML se respeta", () => {
    expect(textToHtmlBody(HTML)).toBe(HTML);
  });
  it("el resumen del paso cerrado no enseña etiquetas", () => {
    const resumen = htmlToPlainText(HTML);
    expect(resumen).not.toContain("<p>");
    expect(resumen.split("\n\n").length).toBe(3);
  });
  it("escapa el texto plano: un '<2 horas' no se come la frase", () => {
    expect(textToHtmlBody("Respondemos en <2 horas")).toContain("&lt;2 horas");
  });
});
