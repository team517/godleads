import { describe, expect, it } from "vitest";
import { domainBrand } from "../../supabase/functions/_shared/company-brand";

export const BRAND_CASES: [string, string | null][] = [
  ["acme.com", "acme"],
  ["acme.fr", "acme"],
  ["acme.co.uk", "acme"],
  ["acme.com.es", "acme"],
  ["mail.acme.es", "acme"],
  ["ventas.grupo-acme.com", "grupo-acme"],
  ["ACME.IO", "acme"],
  ["chipsfinder.com", "chipsfinder"],
  ["gmail.com", null],
  ["hotmail.es", null],
  ["outlook.fr", null],
  ["grupo.es", null],
  ["info.com", null],
  ["abc.es", null], // demasiado corto: coincidiría con cualquiera
  ["", null],
];

describe("domainBrand", () => {
  for (const [d, want] of BRAND_CASES) it(`${d || "(vacío)"} → ${want}`, () => expect(domainBrand(d)).toBe(want));
});
