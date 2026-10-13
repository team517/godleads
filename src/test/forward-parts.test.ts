import { describe, expect, it } from "vitest";
import { bytesToBase64, cidsInHtml, dropMissingCidImages, planForwardParts } from "../../supabase/functions/_shared/forward-parts";

/* Reenviar con todo (13-10-2026): imágenes incrustadas con su Content-ID y adjuntos del original. */

const html = `<p>Hola</p><img src="cid:image001.png@01DB1234" width="120" height="40"><img src='cid:logo%40firma'><img src="https://x.es/a.png">`;

describe("forward-parts", () => {
  it("encuentra los cid del cuerpo (también entre comillas simples y codificados)", () => {
    expect(cidsInHtml(html)).toEqual(["image001.png@01DB1234", "logo@firma"]);
    expect(cidsInHtml("")).toEqual([]);
  });

  it("imagen usada → incrustada; PDF → adjunto; incrustada no usada → fuera; grande y sin guardar → se avisa", () => {
    const plan = planForwardParts([
      { name: "image001.png", mime: "image/png", size: 4000, path: "u/m/image001.png", inline: true, cid: "<image001.png@01DB1234>" },
      { name: "logo.png", mime: "image/png", size: 2000, path: "u/m/logo.png", cid: "logo@firma" },
      { name: "presupuesto.pdf", mime: "application/pdf", size: 90_000, path: "u/m/presupuesto.pdf" },
      { name: "cita-vieja.jpg", mime: "image/jpeg", size: 3000, path: "u/m/cita.jpg", inline: true, cid: "otra@cita" },
      { name: "video.mov", mime: "video/quicktime", size: 30_000_000, path: "", oversized: true },
      { name: "albaran.xlsx", mime: "application/vnd.ms-excel", size: 1000, path: "" },
    ], html);
    expect(plan.inline.map((a) => a.cid)).toEqual(["image001.png@01DB1234", "logo@firma"]);
    expect(plan.files.map((a) => a.name)).toEqual(["presupuesto.pdf"]);
    expect(plan.skipped).toEqual([
      { name: "video.mov", reason: "grande" },
      { name: "albaran.xlsx", reason: "sin_guardar" },
    ]);
  });

  it("respeta el tope de bytes y de adjuntos", () => {
    const files = Array.from({ length: 4 }, (_, i) => ({ name: `f${i}.pdf`, mime: "application/pdf", size: 400, path: `p${i}` }));
    const plan = planForwardParts(files, "<p>x</p>", { maxBytes: 1000, maxFiles: 10 });
    expect(plan.files.map((f) => f.name)).toEqual(["f0.pdf", "f1.pdf"]);
    expect(plan.skipped.map((s) => s.reason)).toEqual(["limite", "limite"]);
    expect(planForwardParts(files, "", { maxFiles: 1 }).files).toHaveLength(1);
  });

  it("quita sólo las imágenes cid que no van en el correo", () => {
    const out = dropMissingCidImages(html, ["image001.png@01DB1234"]);
    expect(out).toContain("cid:image001.png@01DB1234");
    expect(out).not.toContain("logo%40firma");
    expect(out).toContain("https://x.es/a.png");
  });

  it("base64 por trozos igual que btoa", () => {
    const bytes = new Uint8Array(100_000).map((_, i) => i % 256);
    let bin = ""; for (const b of bytes) bin += String.fromCharCode(b);
    expect(bytesToBase64(bytes)).toBe(btoa(bin));
  });
});
