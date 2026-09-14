import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import RichReplyEditor, { domToSource, sourceToHtml, type RichReplyHandle } from "@/components/unibox/RichReplyEditor";

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

describe("RichReplyEditor — componente", () => {
  it("insertLink añade un enlace azul y entrega el texto fuente con <a>", () => {
    const ref = createRef<RichReplyHandle>();
    const onChange = vi.fn();
    render(<RichReplyEditor ref={ref} value="aquí tienes mi enlace " onChange={onChange} placeholder="Escribe tu respuesta…" />);
    act(() => ref.current!.insertLink("https://calendly.com/onepulso/30min", ""));
    const a = screen.getByRole("link", { name: "https://calendly.com/onepulso/30min" });
    expect(a.getAttribute("href")).toBe("https://calendly.com/onepulso/30min");
    expect(onChange).toHaveBeenLastCalledWith('aquí tienes mi enlace <a href="https://calendly.com/onepulso/30min">https://calendly.com/onepulso/30min</a> ');
  });

  it("un valor externo (plantilla/IA) se repinta con sus enlaces", () => {
    const { rerender } = render(<RichReplyEditor value="" onChange={() => {}} placeholder="p" />);
    rerender(<RichReplyEditor value={'Hola\n<a href="https://onepulso.online">web</a>'} onChange={() => {}} placeholder="p" />);
    expect(screen.getByRole("link", { name: "web" })).toBeInTheDocument();
  });

  it("clic en el enlace lo abre en otra pestaña", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    render(<RichReplyEditor value='<a href="https://onepulso.online">web</a>' onChange={() => {}} />);
    fireEvent.click(screen.getByRole("link", { name: "web" }));
    expect(open).toHaveBeenCalledWith("https://onepulso.online", "_blank", "noopener,noreferrer");
    open.mockRestore();
  });
});
