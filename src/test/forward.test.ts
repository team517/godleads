import { describe, expect, it } from "vitest";
import { buildForwardHtml, forwardSubject, plainToForwardHtml } from "@/lib/forward";

/* El caso real (TCX, 18 sept 2026): un reenvío salió con el asunto de OTRA conversación y con el
 * original convertido en un bloque de texto todo junto. Aquí se fija lo que tiene que salir. */

describe("asunto del reenvío", () => {
  it("antepone Fwd: al asunto original, respetando un Re:", () => {
    expect(forwardSubject("Re: TCX MICRO - El Radar - APTIE")).toBe("Fwd: Re: TCX MICRO - El Radar - APTIE");
  });
  it("no apila Fwd: Fwd:", () => {
    expect(forwardSubject("Fwd: Solicitud de presupuesto")).toBe("Fwd: Solicitud de presupuesto");
    expect(forwardSubject("FW: algo")).toBe("FW: algo");
  });
  it("sin asunto no manda un «Fwd: » vacío", () => {
    expect(forwardSubject("")).toBe("Fwd: (sin asunto)");
    expect(forwardSubject(null)).toBe("Fwd: (sin asunto)");
  });
});

describe("cuerpo del reenvío", () => {
  const src = {
    fromName: "Ignacio Dancausa",
    fromEmail: "dancausa@aptie.es",
    when: "18/9/2026, 12:00:52",
    subject: "Re: TCX MICRO - El Radar - APTIE",
    toAccountEmail: "gavin@tcx-micro-supply.com",
    originalHtml: "<p>Hola Gavin,</p><p>¿os interesaría participar en <a href=\"https://www.tecnosec.es\">TECNOSEC</a>?</p><blockquote>El 2026-09-18, Gavin escribió:<br>Buenos días Ignacio</blockquote>",
  };

  it("lleva la cabecera De / Fecha / Asunto / Para, como Gmail", () => {
    const html = buildForwardHtml(src, "");
    expect(html).toContain("---------- Mensaje reenviado ----------");
    expect(html).toContain("<b>De:</b> Ignacio Dancausa &lt;dancausa@aptie.es&gt;");
    expect(html).toContain("<b>Fecha:</b> 18/9/2026, 12:00:52");
    expect(html).toContain("<b>Asunto:</b> Re: TCX MICRO - El Radar - APTIE");
    expect(html).toContain("<b>Para:</b> gavin@tcx-micro-supply.com");
  });

  it("el original va ENTERO y con su estructura (párrafos, enlaces, cita), dentro de un <div>", () => {
    const html = buildForwardHtml(src, "");
    expect(html).toContain(`<div>${src.originalHtml}</div>`);
    expect(html).not.toMatch(/<p>[^<]*---------- Mensaje reenviado/); // nunca dentro de un <p>
  });

  it("la nota va arriba, escapada y con sus saltos de línea", () => {
    const html = buildForwardHtml(src, "Mira esto <urgente>\nGracias");
    const idxNota = html.indexOf("Mira esto &lt;urgente&gt;");
    expect(idxNota).toBeGreaterThan(-1);
    expect(idxNota).toBeLessThan(html.indexOf("Mensaje reenviado"));
    expect(html).toContain('<div style="white-space:pre-wrap">Mira esto &lt;urgente&gt;\nGracias</div>');
  });

  it("sin «Para» no pinta una línea vacía", () => {
    const html = buildForwardHtml({ ...src, toAccountEmail: "" }, "");
    expect(html).not.toContain("<b>Para:</b>");
  });

  it("un original de sólo texto conserva sus saltos de línea", () => {
    expect(plainToForwardHtml("Hola\n\nUn saludo,\nIgnacio")).toBe('<div style="white-space:pre-wrap">Hola\n\nUn saludo,\nIgnacio</div>');
    expect(plainToForwardHtml("<b>x</b>")).toContain("&lt;b&gt;x&lt;/b&gt;");
  });
});
