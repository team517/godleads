import { describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { createRef } from "react";
import RichReplyEditor, { sourceToHtml, type RichReplyHandle } from "@/components/unibox/RichReplyEditor";
import { editorToSource } from "@/lib/mobile-inbox";
import { htmlToPlainText, textToHtmlBody } from "@/lib/mime-headers";
import { fixBlockedLinks } from "../../supabase/functions/_shared/link-guard";

/* Plantillas de respuesta con el Calendly (support@, "INTERESADO QUIERE REUNIÓN"). 05-10-2026 el
   dueño pidió el enlace /30min entero; 06-10-2026 se comprobó que con ese enlace el correo no llega
   (IONOS lo enruta por un servidor en Spamhaus: 6 de 8 respuestas rebotaron) y pidió arreglarlo.
   Ahora: en el editor se ve lo que se escribió, y al enviar sale la URL de perfil, que entrega,
   como enlace entero y también en la parte de texto. */

const URL = "https://calendly.com/onepulso/30min";
const LIMPIA = "https://calendly.com/onepulso";
const PLANTILLA = `Buenas, perfecto, te paso el enlace de mi calendario para que puedas agendar reunión lo antes posible\n<a href="${URL}">${URL}</a>\nquedo atento\nsaludos\nMaria`;
const ANCLA = `<a href="${URL}">${URL}</a>`;

/** Lo que hace send-email con el cuerpo: guardián de enlaces y luego a HTML; la parte de texto
 *  plano del correo sale de htmlToPlainText (smtp.ts buildMimeMessage). */
function comoLoEnviaElServidor(body: string) {
  const guard = fixBlockedLinks(body);
  const html = textToHtmlBody(guard.text.trim());
  return { html, plain: htmlToPlainText(html), cambios: guard.fixes };
}

describe("Calendly /30min en las plantillas de respuesta", () => {
  it("Unibox del ordenador: aplicar la plantilla y enviar", () => {
    const ref = createRef<RichReplyHandle>();
    render(<RichReplyEditor ref={ref} placeholder="Escribe tu respuesta…" />);
    act(() => ref.current!.insertText(PLANTILLA));
    // Se ve como enlace azul, con la URL entera.
    const a = screen.getByRole("link", { name: URL });
    expect(a.getAttribute("href")).toBe(URL);
    // Lo que se manda al servidor lleva el enlace entero.
    const src = ref.current!.getSource();
    expect(src).toContain(ANCLA);
    const sent = comoLoEnviaElServidor(src);
    expect(sent.cambios).toEqual([{ from: "calendly.com/onepulso/30min", to: "calendly.com/onepulso" }]);
    expect(sent.html).toContain(`href="${LIMPIA}"`);
    expect(sent.html).toContain(`>${LIMPIA}</a>`);
    expect(sent.html).not.toContain("/30min");
    expect(sent.plain).toContain(LIMPIA);                   // también en la parte de texto
    expect(sent.plain).not.toContain("/30min");
  });

  it("App del móvil: insertar la plantilla en el editor y enviar", () => {
    const el = document.createElement("div");
    el.contentEditable = "true";
    el.innerHTML = sourceToHtml(PLANTILLA);                  // lo que hace Composer.insertTemplate
    const a = el.querySelector("a")!;
    expect(a.getAttribute("href")).toBe(URL);
    expect(a.textContent).toBe(URL);
    const body = editorToSource(el);                          // lo que manda Composer al enviar
    expect(body).toContain(ANCLA);
    const sent = comoLoEnviaElServidor(body);
    expect(sent.html).toContain(`href="${LIMPIA}"`);
    expect(sent.html).not.toContain("/30min");
    expect(sent.plain).toContain(LIMPIA);
  });

  it("si se escribe la URL /30min a mano, también se cambia por la que entrega", () => {
    const sent = comoLoEnviaElServidor(`te dejo mi agenda: ${URL} saludos`);
    expect(sent.html).toContain(LIMPIA);
    expect(sent.html).not.toContain("/30min");
    expect(sent.plain).toContain(LIMPIA);
  });
});
