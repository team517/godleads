import { describe, expect, it } from "vitest";
import { plainTextBody, stripTrackingParams } from "../../supabase/functions/_shared/text-only";

/* Correos "sólo texto" (06-10-2026): un cuerpo con negritas o enlaces se CONVIERTE a texto bien
   estructurado en vez de desactivar el modo (lo que hacía que las campañas "sólo texto" salieran
   en HTML sin saberlo: 592 de 594 envíos de support@ el 06-10). Los enlaces se respetan enteros. */

const PM = "Hola Yolanda,\n\nSoy Juan. Vi a <b>Alive Business Consulting</b> y me apasionó cómo ayudáis a empresas medianas.\n\nY no, esto no es una plantilla.\n\nPrecisamente en OnePulso ayudamos a empresas como la vuestra, buscando generar <b>entre 15 y 20 oportunidades comerciales</b> al mes.\n\n¿Te encaja que veamos una <b>demostración</b> esta semana?\n\nUn saludo,\nJuan";

describe("sólo texto: plainTextBody", () => {
  it("quita las negritas y conserva los párrafos y los saltos del autor", () => {
    const out = plainTextBody(PM);
    expect(out).toBe("Hola Yolanda,\n\nSoy Juan. Vi a Alive Business Consulting y me apasionó cómo ayudáis a empresas medianas.\n\nY no, esto no es una plantilla.\n\nPrecisamente en OnePulso ayudamos a empresas como la vuestra, buscando generar entre 15 y 20 oportunidades comerciales al mes.\n\n¿Te encaja que veamos una demostración esta semana?\n\nUn saludo,\nJuan");
    expect(out).not.toMatch(/<[a-z/]/i);
  });

  it("un enlace escrito como <a> sale UNA vez y entero (el Calendly de los seguimientos)", () => {
    const body = "Te dejo mi calendario para que elijas el momento que mejor te venga:\n<a href=\"https://calendly.com/onepulso/30min\">https://calendly.com/onepulso/30min</a>\n\nSi no, dime y lo vemos.";
    expect(plainTextBody(body)).toBe("Te dejo mi calendario para que elijas el momento que mejor te venga:\nhttps://calendly.com/onepulso/30min\n\nSi no, dime y lo vemos.");
  });

  it("un enlace con texto propio lleva la dirección entre paréntesis", () => {
    expect(plainTextBody('Reserva <a href="https://calendly.com/onepulso/30min">aquí</a>.')).toBe("Reserva aquí (https://calendly.com/onepulso/30min).");
  });

  it("un texto sin etiquetas se respeta tal cual, con sus enlaces", () => {
    const t = "Hola,\n\nMira esto: https://onepulso.online/precios\n\nSaludos";
    expect(plainTextBody(t)).toBe(t);
  });

  it("sólo se quitan los parámetros de seguimiento, no el enlace", () => {
    expect(stripTrackingParams("ver https://x.es/p?utm_source=a&id=7&utm_medium=b#top ok")).toBe("ver https://x.es/p?id=7#top ok");
    expect(stripTrackingParams("https://calendly.com/onepulso/30min?utm_campaign=x")).toBe("https://calendly.com/onepulso/30min");
    expect(stripTrackingParams("https://calendly.com/onepulso/30min")).toBe("https://calendly.com/onepulso/30min");
  });

  it("HTML con párrafos <p> y <br> se convierte con líneas en blanco entre párrafos", () => {
    expect(plainTextBody("<p>Hola <b>Ana</b>,</p><p>Primera idea.<br>Segunda idea.</p><p>Saludos</p>")).toBe("Hola Ana,\n\nPrimera idea.\nSegunda idea.\n\nSaludos");
  });

  it("no deja más de una línea en blanco seguida ni espacios dobles", () => {
    expect(plainTextBody("A\n\n\n\nB  C   D\n\n\nE")).toBe("A\n\nB C D\n\nE");
  });
});
