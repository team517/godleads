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

import { csvMetricas, haceCuanto, horaCorta, conversacionesRecientes } from "@/lib/ia-mod-view";
describe("Modificaciones IA — utilidades del diseño nuevo", () => {
  const now = Date.parse("2026-09-27T12:00:00");
  it("hace cuánto (conversaciones recientes)", () => {
    expect(haceCuanto("2026-09-27T11:55:00", now)).toBe("Hace 5 min");
    expect(haceCuanto("2026-09-27T10:00:00", now)).toBe("Hace 2 horas");
    expect(haceCuanto("2026-09-26T12:00:00", now)).toBe("Hace 1 día");
    expect(haceCuanto("2026-09-24T12:00:00", now)).toBe("Hace 3 días");
  });
  it("hora bajo la burbuja: sólo la hora si es de hoy", () => {
    expect(horaCorta("2026-09-27T10:24:00", now)).toBe("10:24");
    expect(horaCorta("2026-09-26T18:05:00", now)).toBe("ayer 18:05");
  });
  it("recientes: sólo con conversación, la última primero", () => {
    const c = (id: string, at: string | null) => ({ id, email: `${id}@x.es`, full_name: "", company_name: id, logo_url: null, brand_color: null, campaigns: 0, active: 0, last_chat_at: at });
    expect(conversacionesRecientes([c("a", "2026-09-20T10:00:00Z"), c("b", null), c("c", "2026-09-27T10:00:00Z")]).map((x) => x.id)).toEqual(["c", "a"]);
  });
  it("CSV para Excel en español: BOM, ';' y decimales con coma", () => {
    const csv = csvMetricas({
      type: "metricas", titulo: "Campaña; uno", subtitulo: "", dias: 7,
      totales: { enviados_periodo: 10, respuestas_periodo: 1, enviados: 20, contactados: 15, respuestas: 2, interesados: 1, rebotes: 0, tasa_respuesta: 13.3 },
      serie: [{ day: "2026-09-26", sends: 10, replies: 1 }], campanas: [],
    });
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain('"Campaña; uno"');
    expect(csv).toContain("2026-09-26;10;1");
    expect(csv).toContain("Tasa de respuesta (%);13,3");
    expect(csv).toContain("\r\n");
  });
});
