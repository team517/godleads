import { describe, expect, it } from "vitest";
import { CUPO_EMPRESA_DIA, HUECO_EMPRESA_MIN, puedeEscribirEmpresa } from "../../supabase/functions/_shared/company-pace";

/* 06-10-2026: el cupo diario por empresa (3) sólo frena PRIMEROS correos. Los seguimientos sólo
 * respetan el hueco de 90 min (482 seguimientos a orange.com, stellantis… iban >7 días tarde). */

const ahora = Date.parse("2026-10-06T12:00:00Z");
const lleno = { n: CUPO_EMPRESA_DIA, ultimoMs: ahora - 5 * 60 * 60_000 };

describe("cupo por empresa sólo para primeros correos", () => {
  it("primer correo con el cupo lleno: espera a mañana (como siempre)", () => {
    expect(puedeEscribirEmpresa(lleno, ahora)).toBe("cupo");
    expect(puedeEscribirEmpresa(lleno, ahora, CUPO_EMPRESA_DIA, HUECO_EMPRESA_MIN, true)).toBe("cupo");
  });
  it("seguimiento con el cupo lleno: sale", () => {
    expect(puedeEscribirEmpresa(lleno, ahora, CUPO_EMPRESA_DIA, HUECO_EMPRESA_MIN, false)).toBe("si");
    expect(puedeEscribirEmpresa({ n: 40, ultimoMs: ahora - 2 * 60 * 60_000 }, ahora, 3, 90, false)).toBe("si");
  });
  it("seguimiento: el hueco de 90 min se sigue respetando", () => {
    expect(puedeEscribirEmpresa({ n: 5, ultimoMs: ahora - 10 * 60_000 }, ahora, 3, 90, false)).toBe("espera");
    expect(puedeEscribirEmpresa({ n: 1, ultimoMs: ahora - 89 * 60_000 }, ahora, 3, 90, false)).toBe("espera");
  });
  it("el motor pasa 'primer correo' según el paso del lead", () => {
    const src = require("node:fs").readFileSync(
      require("node:path").resolve(__dirname, "../../supabase/functions/process-campaign-queue/index.ts"), "utf8");
    expect(src).toMatch(/const primerCorreo = \(cl\.current_step \|\| 0\) === 0;/);
    expect(src).toMatch(/cupoEmpresa, huecoEmpresaMin, primerCorreo\)/);
  });
});
