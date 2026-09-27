import { describe, expect, it } from "vitest";
import { horaMensaje, nombreCliente, puedeVerIaMod, diaCorto } from "@/lib/ia-mod-view";

describe("Modificaciones IA — pantalla", () => {
  it("el menú sólo lo ven hello@, support@ y equipo@ (igual que el servidor)", () => {
    expect(["hello@onepulso.blog", "support@onepulso.online", "EQUIPO@onepulso.online"].every(puedeVerIaMod)).toBe(true);
    expect(puedeVerIaMod("team@onepulso.online")).toBe(false);
    expect(puedeVerIaMod("simone.ferrali@energika.es")).toBe(false);
  });
  it("nombre del cliente: empresa, si no nombre, si no el correo", () => {
    expect(nombreCliente({ company_name: "Energika", full_name: "Simone", email: "s@e.es" })).toBe("Energika");
    expect(nombreCliente({ company_name: "", full_name: "Simone", email: "s@e.es" })).toBe("Simone");
    expect(nombreCliente({ company_name: "", full_name: "", email: "simone@e.es" })).toBe("simone");
  });
  it("hora de los mensajes", () => {
    const now = Date.parse("2026-09-27T12:00:00");
    expect(horaMensaje("2026-09-27T11:59:40", now)).toBe("ahora");
    expect(horaMensaje("2026-09-27T11:30:00", now)).toBe("hace 30 min");
    expect(horaMensaje("2026-09-26T18:05:00", now)).toMatch(/^ayer 18:05$/);
  });
  it("día corto de la gráfica", () => {
    expect(diaCorto("2026-09-27")).toMatch(/27 sept/);
  });
});
