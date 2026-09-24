import { describe, expect, it } from "vitest";
import { repairMojibakeBytes } from "@/lib/reply-text";

// Un CSV guardado en la codificación equivocada trae "diseÃ±o" en vez de "diseño". Como
// company_name se mete dentro del correo, el lead lo recibiría mal escrito (24-09-2026).
describe("tildes rotas al importar leads", () => {
  it("repara los casos reales encontrados", () => {
    expect(repairMojibakeBytes("Atwork diseÃ±o y comunicaciÃ³n")).toBe("Atwork diseño y comunicación");
    expect(repairMojibakeBytes("Agencia Marketing online A CoruÃ±a")).toBe("Agencia Marketing online A Coruña");
    expect(repairMojibakeBytes("Faino ComunicaciÃ³, sl")).toBe("Faino Comunicació, sl");
  });
  it("no toca un texto que ya está bien", () => {
    expect(repairMojibakeBytes("Diseño y comunicación")).toBe("Diseño y comunicación");
    expect(repairMojibakeBytes("Machinas")).toBe("Machinas");
    expect(repairMojibakeBytes("")).toBe("");
  });
});
