import { describe, expect, it } from "vitest";
import { inlineImageCids, inlineImageFor, replaceCidImages } from "@/lib/unibox-text";

/* Firmas con logo (06-10-2026): el HTML trae src="cid:…" y la imagen va guardada como adjunto inline. */
const html = '<p>Un saludo</p><img border="0" width="140" src="cid:image001.png@01DD5592.F851A7B0" alt="GrupoBGO"><img src="cid:otra@x"><img src="https://ejemplo.es/a.png">';

describe("imágenes incrustadas", () => {
  it("lista los cid del HTML", () => {
    expect(inlineImageCids(html)).toEqual(["image001.png@01DD5592.F851A7B0", "otra@x"]);
    expect(inlineImageCids("<p>sin imágenes</p>")).toEqual([]);
  });
  it("encuentra la imagen por cid o por nombre", () => {
    const atts = [{ path: "u/m/image001.png", name: "image001.png", inline: true }, { path: "u/m/logo.png", name: "logo.png", cid: "otra@x", inline: true }, { path: "u/m/doc.pdf", name: "doc.pdf" }];
    expect(inlineImageFor("image001.png@01DD5592.F851A7B0", atts)?.path).toBe("u/m/image001.png");
    expect(inlineImageFor("otra@x", atts)?.path).toBe("u/m/logo.png");
    expect(inlineImageFor("nada@x", atts)).toBeNull();
  });
  it("cambia el cid por el enlace y quita la imagen que no está; las remotas no se tocan", () => {
    const out = replaceCidImages(html, (c) => (c.startsWith("image001") ? "https://s.supabase.co/signed?x=1&y=2" : null));
    expect(out).toContain('src="https://s.supabase.co/signed?x=1&y=2"');
    expect(out).not.toContain("cid:");
    expect(out).toContain('<img src="https://ejemplo.es/a.png">');
    expect(out).toContain('alt="GrupoBGO"');
  });
});

describe("el filtro de píxeles de seguimiento no se lleva los logos (06-10-2026)", () => {
  it("quita sólo las imágenes de 1×1; width=107 o height=137 se quedan", async () => {
    const { cleanBodyHtml } = await import("@/lib/unibox-text");
    const html = '<p>Hola</p><img width="1" height="1" src="https://t.example/p.gif"><img width="107" height="26" src="https://ejemplo.es/instagram.png" alt="instagram"><img width="189" height="137" src="https://ejemplo.es/logo.png" alt="logo"><img width=1 src="https://t.example/q.gif">';
    const out = cleanBodyHtml(html);
    expect(out).not.toContain("p.gif");
    expect(out).not.toContain("q.gif");
    expect(out).toContain('alt="instagram"');
    expect(out).toContain('alt="logo"');
  });
});
