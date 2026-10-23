import { describe, expect, it } from "vitest";
import { renderableHtml, cleanBodyText } from "@/lib/unibox-text";

/* El Unibox borraba los códigos de pieza al pintar el HTML (23-10-2026, Chipsfinder):
   "pn de THAT CORP.: 4305Q16-U" se veía "THAT CORP.: -U". */
const PRODYS = '<html><head><style>p.MsoNormal{margin:0}</style></head><body><p class="MsoNormal"><span lang="ES">Soy la encargada del dpto. de Compras y me gustaría saber si podrían ofertarnos el siguiente pn de THAT CORP.:\r\n</span><span style="font-family:&quot;Arial&quot;,sans-serif;color:black">4305Q16-U .&nbsp; Estamos buscando cubrir un faltante de 100 pcs.<o:p></o:p></span></p></body></html>';
const GMV = '<p class="MsoNormal"><span lang="EN-US" style="color:#3A7C22">Could you please send me a quote for 150 or 200 pcs of P018495 - Modulo memoria DDR3L 1600 SO-DIMM 4GB Non ECC 204pin(TRANSCEND:TS512MSK64W6H-I)?</span></p><p>P/N TS512MSK64V6N-I · STM32F407VGT6 · ref 0396QKE · EAN 8412345678905 · Monitor 7” VGA 9-36Vdc · 60€/pc</p>';

const visible = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");

describe("Códigos de pieza en el Unibox", () => {
  it("el HTML conserva el pn completo", () => {
    expect(visible(renderableHtml(PRODYS))).toContain("4305Q16-U");
  });
  it("y todos los demás códigos, tal cual", () => {
    const v = visible(renderableHtml(GMV));
    for (const c of ["P018495", "DDR3L", "SO-DIMM", "204pin(TRANSCEND:TS512MSK64W6H-I)", "TS512MSK64V6N-I", "STM32F407VGT6", "0396QKE", "8412345678905", "Monitor 7” VGA 9-36Vdc", "60€/pc"]) {
      expect(v).toContain(c);
    }
  });
  it("la versión de texto también", () => {
    expect(cleanBodyText("pn de THAT CORP.: 4305Q16-U . Faltante de 100 pcs. P018495 TS512MSK64W6H-I", true)).toContain("4305Q16-U . Faltante de 100 pcs. P018495 TS512MSK64W6H-I");
  });
});
