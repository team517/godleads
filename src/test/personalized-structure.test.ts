import { describe, expect, it } from "vitest";
import { hasHtmlMarkup, htmlToPlainText, textToHtmlBody } from "../../supabase/functions/_shared/mime-headers";
import { replaceVariables } from "../../supabase/functions/_shared/personalize";

/* 04-10-2026: los personalized_message de support@ llegaban como un único bloque. La función SQL
   format_personalized_message (migración 20261004060000) los guarda con párrafos (línea en blanco),
   la firma en tres líneas y <b> en tres frases. Aquí se comprueba que ESO, pasado por el mismo
   código que usan el motor y send-email, sale como un correo bien maquetado. El mensaje es una
   salida real de la función. */

const FORMATEADO = [
  "Hola Stefano,",
  "Soy Samuel. Vi a <b>Athena Systems</b> y me apasionó cómo habéis construido una plataforma que unifica gestión de carteras, riesgos, trading, operaciones y contabilidad en un mismo sistema, con cumplimiento normativo cubierto de principio a fin.",
  "Precisamente en OnePulso nos especializamos en ayudar a empresas como la vuestra a conseguir oportunidades con vuestro cliente ideal de forma recurrente, alcanzando <b>entre 15 y 20 oportunidades mensuales</b> con ese perfil de cliente.",
  "Hemos preparado una <b>demo personalizada</b> para Athena Systems, para enseñarte cómo lo aplicaríamos en vuestro caso. ¿Tendrías 15 minutos para verla juntos?",
  "Saludos,\nSamuel\nOnePulso",
].join("\n\n");

describe("personalized_message con estructura → correo", () => {
  it("cada párrafo es un <p>, la firma va en líneas con <br> y las negritas se mantienen", () => {
    const html = textToHtmlBody(FORMATEADO);
    expect(html.match(/<p /g)).toHaveLength(5);
    expect(html.startsWith('<p style="margin:0 0 14px">Hola Stefano,</p>')).toBe(true);
    expect(html.endsWith('<p style="margin:0 0 14px">Saludos,<br>Samuel<br>OnePulso</p>')).toBe(true);
    expect(html).toContain("Vi a <b>Athena Systems</b> y me apasionó");
    expect(html).toContain("<b>demo personalizada</b>");
    expect(html).not.toContain("&lt;b&gt;");
  });

  it("lleva HTML, así que sale en HTML aunque la campaña esté en 'sólo texto' (el motor fuerza HTML)", () => {
    expect(hasHtmlMarkup(FORMATEADO)).toBe(true);
  });

  it("con el paso = {{personalized_message}} (campaña 'juan onepulso') el correo es el mensaje maquetado entero", () => {
    const cuerpo = replaceVariables("{{personalized_message}}", { personalized_message: FORMATEADO, first_name: "Stefano" });
    expect(textToHtmlBody(cuerpo)).toBe(textToHtmlBody(FORMATEADO));
    // La versión de texto del mismo correo también va por párrafos y acaba con la firma completa.
    const texto = htmlToPlainText(textToHtmlBody(cuerpo));
    expect(texto).toMatch(/Hola Stefano,\n\nSoy Samuel\./);
    expect(texto.trim().endsWith("Saludos,\nSamuel\nOnePulso")).toBe(true);
  });

  it("los que venían en HTML de párrafos (22-09) quedan en el mismo formato y salen igual de maquetados", () => {
    // Salida real de la función para un mensaje <p>…</p> con <strong> y firma "Un saludo,<br>Eric".
    const deHtml = "Hola Jorge,\n\nHe investigado <strong>The Modern Kids & Family</strong> en LinkedIn y me he quedado impresionado.\n\n¿Te va bien esta semana para verlo?\n\nUn saludo,\nEric";
    const html = textToHtmlBody(deHtml);
    expect(html.match(/<p /g)).toHaveLength(4);
    expect(html).toContain("<strong>The Modern Kids & Family</strong>");
    expect(html.endsWith('<p style="margin:0 0 14px">Un saludo,<br>Eric</p>')).toBe(true);
    // Metido en un paso con más texto alrededor, ese texto conserva sus párrafos (con <p> no).
    const paso = replaceVariables("Buenas {{first_name}},\n\n{{personalized_message}}\n\nP.D.: te dejo mi web.", { first_name: "Jorge", personalized_message: deHtml });
    expect(textToHtmlBody(paso).match(/<p /g)).toHaveLength(6);
  });

  it("antes (una sola línea) salía como UN párrafo: por eso llegaba todo junto", () => {
    const plano = FORMATEADO.replace(/<\/?b>/g, "").replace(/\s+/g, " ");
    expect(textToHtmlBody(plano).match(/<p /g)).toHaveLength(1);
  });
});
