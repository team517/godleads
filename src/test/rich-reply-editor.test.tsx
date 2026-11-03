import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import RichReplyEditor, { domToSource, linkifySource, sourceToHtml, type RichReplyHandle } from "@/components/unibox/RichReplyEditor";

describe("RichReplyEditor — fuente ↔ pintado", () => {
  it("pinta un <a> como enlace real y escapa el resto", () => {
    const html = sourceToHtml('hola <b>x</b>\naquí <a href="https://calendly.com/onepulso/30min">mi agenda</a> fin');
    expect(html).toBe('hola &lt;b&gt;x&lt;/b&gt;<br>aquí <a href="https://calendly.com/onepulso/30min" title="https://calendly.com/onepulso/30min">mi agenda</a> fin');
  });

  it("vuelve del DOM al mismo texto fuente (ida y vuelta)", () => {
    const src = 'línea 1\n\nlínea 3 con <a href="https://x.es">x</a>\nfin';
    const div = document.createElement("div");
    div.innerHTML = sourceToHtml(src);
    expect(domToSource(div)).toBe(src);
  });

  it("los <div> que crea el navegador al pulsar Intro son saltos de línea", () => {
    const div = document.createElement("div");
    div.innerHTML = "línea 1<div>línea 2</div><div><br></div><div>línea 4</div>";
    expect(domToSource(div)).toBe("línea 1\nlínea 2\n\nlínea 4");
  });
});

describe("RichReplyEditor — componente (no controlado)", () => {
  it("insertLink añade un enlace azul; getSource entrega el texto fuente con <a>", () => {
    const ref = createRef<RichReplyHandle>();
    render(<RichReplyEditor ref={ref} defaultValue="aquí tienes mi enlace " placeholder="Escribe tu respuesta…" />);
    act(() => ref.current!.insertLink("https://calendly.com/onepulso/30min", ""));
    const a = screen.getByRole("link", { name: "https://calendly.com/onepulso/30min" });
    expect(a.getAttribute("href")).toBe("https://calendly.com/onepulso/30min");
    expect(ref.current!.getSource()).toBe('aquí tienes mi enlace <a href="https://calendly.com/onepulso/30min">https://calendly.com/onepulso/30min</a> ');
  });

  it("setSource (plantilla/IA) reemplaza el contenido y pinta sus enlaces", () => {
    const ref = createRef<RichReplyHandle>();
    render(<RichReplyEditor ref={ref} placeholder="p" />);
    act(() => ref.current!.setSource('Hola\n<a href="https://onepulso.online">web</a>'));
    expect(screen.getByRole("link", { name: "web" })).toBeInTheDocument();
    expect(ref.current!.getSource()).toBe('Hola\n<a href="https://onepulso.online">web</a>');
    expect(ref.current!.isEmpty()).toBe(false);
  });

  it("avisa a onEmptyChange sólo al cambiar de vacío a con-texto, no en cada tecla", () => {
    const ref = createRef<RichReplyHandle>();
    const onEmptyChange = vi.fn();
    render(<RichReplyEditor ref={ref} onEmptyChange={onEmptyChange} placeholder="p" />);
    act(() => ref.current!.setSource("hola"));
    expect(onEmptyChange).toHaveBeenLastCalledWith(false);
    act(() => ref.current!.setSource("hola mundo"));   // sigue con texto → no vuelve a avisar
    expect(onEmptyChange).toHaveBeenCalledTimes(1);
    act(() => ref.current!.setSource(""));             // se vacía → avisa
    expect(onEmptyChange).toHaveBeenLastCalledWith(true);
    expect(onEmptyChange).toHaveBeenCalledTimes(2);
  });

  it("clic en el enlace lo abre en otra pestaña", () => {
    const ref = createRef<RichReplyHandle>();
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    render(<RichReplyEditor ref={ref} defaultValue='<a href="https://onepulso.online">web</a>' />);
    fireEvent.click(screen.getByRole("link", { name: "web" }));
    expect(open).toHaveBeenCalledWith("https://onepulso.online", "_blank", "noopener,noreferrer");
    open.mockRestore();
  });
});


/* Enlaces automáticos (03-11-2026): una URL pegada o escrita se vuelve clicable sola. */
describe("RichReplyEditor — enlaces automáticos", () => {
  it("linkifySource enlaza las URL sueltas y respeta las que ya son enlace y la puntuación", () => {
    expect(linkifySource("Os dejo mi calendario https://calendly.com/onepulso.\nGracias")).toBe(
      'Os dejo mi calendario <a href="https://calendly.com/onepulso">https://calendly.com/onepulso</a>.\nGracias');
    const ya = 'ver <a href="https://x.es">mi agenda</a> y https://y.es/p?a=1&b=2';
    expect(linkifySource(ya)).toBe('ver <a href="https://x.es">mi agenda</a> y <a href="https://y.es/p?a=1&b=2">https://y.es/p?a=1&b=2</a>');
    expect(linkifySource("sin enlaces")).toBe("sin enlaces");
  });

  it("al pegar texto con una URL, queda como enlace y getSource la devuelve con <a>", () => {
    const ref = createRef<RichReplyHandle>();
    render(<RichReplyEditor ref={ref} id="e" />);
    const el = screen.getByRole("textbox");
    act(() => { el.focus(); });
    fireEvent.paste(el, { clipboardData: { getData: () => "Reserva aquí: https://cal.com/xavier-falco-hszeeb/15min gracias" } });
    expect(el.querySelector("a")?.getAttribute("href")).toBe("https://cal.com/xavier-falco-hszeeb/15min");
    expect(ref.current!.getSource()).toContain('<a href="https://cal.com/xavier-falco-hszeeb/15min">https://cal.com/xavier-falco-hszeeb/15min</a> gracias');
  });

  it("escribir una URL y pulsar espacio la convierte en enlace en el sitio", () => {
    const ref = createRef<RichReplyHandle>();
    render(<RichReplyEditor ref={ref} id="e2" />);
    const el = screen.getByRole("textbox");
    el.textContent = "mira https://onepulso.com";
    const range = document.createRange();
    range.setStart(el.firstChild!, (el.firstChild as Text).length);
    range.collapse(true);
    const sel = window.getSelection()!; sel.removeAllRanges(); sel.addRange(range);
    fireEvent.keyDown(el, { key: " " });
    expect(el.querySelector("a")?.getAttribute("href")).toBe("https://onepulso.com");
    expect(domToSource(el)).toBe('mira <a href="https://onepulso.com">https://onepulso.com</a>');
  });
});
