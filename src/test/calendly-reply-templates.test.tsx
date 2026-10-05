import { describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { createRef } from "react";
import RichReplyEditor, { sourceToHtml, type RichReplyHandle } from "@/components/unibox/RichReplyEditor";
import { editorToSource } from "@/lib/mobile-inbox";
import { htmlToPlainText, textToHtmlBody } from "@/lib/mime-headers";
import { fixBlockedLinks } from "../../supabase/functions/_shared/link-guard";

/* Plantillas de respuesta con el Calendly de 30 min (05-10-2026, petición del dueño): desde el
   Unibox del ordenador y desde la app del móvil, el enlace tiene que salir ENTERO y como enlace.
   El cuerpo es el de la plantilla real "INTERESADO QUIERE REUNIÓN" (support@). */

const URL = "https://calendly.com/onepulso/30min";
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
    expect(sent.cambios).toEqual([]);                       // ya no se recorta
    expect(sent.html).toContain(`href="${URL}"`);
    expect(sent.html).toContain(`>${URL}</a>`);
    expect(sent.plain).toContain(URL);                      // también en la parte de texto
    expect(sent.plain).not.toMatch(/calendly\.com\/onepulso(?!\/30min)/);
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
    expect(sent.html).toContain(`href="${URL}"`);
    expect(sent.plain).toContain(URL);
  });

  it("si se escribe la URL a mano sin enlace, también llega entera", () => {
    const sent = comoLoEnviaElServidor(`te dejo mi agenda: ${URL} saludos`);
    expect(sent.html).toContain(URL);
    expect(sent.plain).toContain(URL);
  });
});
