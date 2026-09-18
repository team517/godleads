import { describe, expect, it } from "vitest";
import { htmlToPlainText } from "../../supabase/functions/_shared/mime-headers";
import { cleanBodyHtml } from "@/pages/Unibox";

/* Reenviar un correo lo dejaba "todo junto": la versión de TEXTO no separaba listas ni tablas, y
 * el visor se comía los espacios que muchos pies meten dentro de un <span>. (18-09-2026) */

describe("la versión de texto de un correo con estructura", () => {
  it("una lista sale con un punto por línea, no pegada", () => {
    const html = "<p>Necesitamos:</p><ul><li>PN LM140K-5.0 — 2 uds</li><li>P/N CD4049UBF — 5 uds</li></ul><p>¿Plazo?</p>";
    const text = htmlToPlainText(html);
    expect(text).toContain("- PN LM140K-5.0 — 2 uds");
    expect(text).toContain("- P/N CD4049UBF — 5 uds");
    expect(text).not.toContain("udsP/N");          // era justo el defecto
    expect(text.split("\n").filter((l) => l.startsWith("- "))).toHaveLength(2);
  });

  it("una tabla sale por filas, con las celdas separadas", () => {
    const text = htmlToPlainText("<table><tr><td>LEAT S.p.A.</td><td>+39 011 248 3711</td></tr><tr><td>Turín</td><td>Italia</td></tr></table>");
    expect(text).toContain("LEAT S.p.A. | +39 011 248 3711");
    expect(text).toContain("Turín | Italia");
    expect(text).not.toMatch(/S\.p\.A\.\+39/);
    expect(text.trimEnd().endsWith("|")).toBe(false);   // la última celda no arrastra separador
  });

  it("títulos, párrafos y separadores dejan su hueco", () => {
    const text = htmlToPlainText("<h2>Presupuesto</h2><p>Primero.</p><hr><p>Segundo.</p>");
    expect(text).toMatch(/Presupuesto\n\nPrimero\./);
    expect(text).toContain("---");
    expect(text).toMatch(/Segundo\.$/);
  });

  it("un enlace se escribe una sola vez si su texto ya es la dirección", () => {
    expect(htmlToPlainText('<p><a href="https://calendly.com/onepulso/30min">https://calendly.com/onepulso/30min</a></p>'))
      .toBe("https://calendly.com/onepulso/30min");
    expect(htmlToPlainText('<p><a href="https://onepulso.online">nuestra web</a></p>'))
      .toBe("nuestra web (https://onepulso.online)");
  });

  it("entidades y saltos: ni códigos sueltos ni tres líneas en blanco seguidas", () => {
    const text = htmlToPlainText("<p>Caf&eacute;&nbsp;con leche &amp; t&eacute;</p><br><br><br><p>Fin</p>");
    expect(text).toContain("&");
    expect(text).not.toContain("&nbsp;");
    expect(text).not.toMatch(/\n{3,}/);
  });

  it("no se traga el texto de un correo normal", () => {
    expect(htmlToPlainText("<p>Hola María</p><p>¿Hablamos el lunes?</p>")).toBe("Hola María\n\n¿Hablamos el lunes?");
  });
});

describe("el visor no se come los espacios del pie", () => {
  // Caso real (el Ruso de Rocky): el pie separa cada palabra con <span>&nbsp;</span>.
  const pie = '<div dir="ltr"><div>Muchas gracias pero no estamos interesados</div>'
    + '<p><font>Este<span style="letter-spacing:-0.65pt"> </span>mensaje<span style="letter-spacing:-0.65pt"> </span>y'
    + '<span style="letter-spacing:-0.65pt"> </span>sus<span style="letter-spacing:-0.65pt"> </span>archivos</font></p></div>';

  it("las palabras del pie no se pegan", () => {
    const texto = cleanBodyHtml(pie, true).replace(/<[^>]+>/g, " ").replace(/ /g, " ").replace(/\s+/g, " ");
    expect(texto).toContain("Este mensaje y sus archivos");
    expect(texto).not.toContain("Estemensaje");
  });

  it("los envoltorios de verdad vacíos se siguen quitando", () => {
    expect(cleanBodyHtml("<div><p></p><span></span>Hola</div>", true).replace(/<[^>]+>/g, "").trim()).toBe("Hola");
  });
});
