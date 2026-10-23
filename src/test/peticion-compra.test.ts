import { describe, expect, it } from "vitest";
import { classifyMessage, isPurchaseRequest } from "../../supabase/functions/_shared/classify";

/* Peticiones de compra que el modelo dejaba en "neutral" (sin categoría): GMV y Prodys → Chipsfinder,
   21/23-10-2026. Las reglas ya decían interesado; ahora el cron no deja que el modelo lo baje. */
const FIRMA = "\n\nKind regards,\n\nTeresa de Diego\nGestor de compras/ Purchasing agent";

describe("Petición de compra", () => {
  const SI = [
    "Hello,\n\nCould you please send me a quote for 150 or 200 pcs of P018495 - Modulo memoria DDR3L 1600 SO-DIMM 4GB Non ECC 204pin(TRANSCEND:TS512MSK64W6H-I)?" + FIRMA,
    "Hello,\n\nCould you please send me a quote for 4 pcs of P018761 - Monitor 7” VGA 9-36Vdc 500nits tactil RS232 AMT (INELMATIC:OF700HB-RN-1872)?\n\nThe supplier has told this model has recently obsoleted." + FIRMA,
    "Hello,\n\nCould you please send a quote for P016405 Modulo ARM9 con procesador I.MX28 450 MHZ rev300 (TQ:TQMA28-AD)?\n\nWe need it for 150, 300 and 600 pcs." + FIRMA,
    "Hello,\n\nThis is the P/N we need: TS512MSK64W6H-I" + FIRMA,
    "Hello,\n\nI don’t have a photo, but the P/N is TS512MSK64V6N-I." + FIRMA,
    "Buenas tardes,\n\nSoy la encargada del dpto. de Compras y me gustaría saber si podrían ofertarnos el siguiente pn de THAT CORP.: 4305Q16-U . Estamos buscando cubrir un faltante de 100 pcs.",
    "Hola, ¿nos podéis enviar un presupuesto para 300 unidades de la referencia STM32F103?",
  ];
  for (const t of SI) it(`sí: ${t.replace(/\s+/g, " ").slice(7, 70)}…`, () => expect(isPurchaseRequest(t)).toBe(true));

  const NO = [
    "Gracias, pero no estamos interesados.",
    "Hello, thanks for reaching out. Not for now.",
    "Por favor, no me escribáis más.",
    "Hola, ¿quién os ha dado mi correo?",
    "Thanks, I'll keep your details on file for the future.",
    "Surface Pro 11th Edition for Business — official Amazon Business offer · exclusive business pricing",
  ];
  for (const t of NO) it(`no: ${t.slice(0, 50)}`, () => expect(isPurchaseRequest(t)).toBe(false));

  it("las reglas ya lo leían como interés (la red de seguridad sólo actúa entonces)", () => {
    for (const t of SI.slice(0, 5)) expect(classifyMessage("QUOTE", t)).toBe("interested");
  });
});
