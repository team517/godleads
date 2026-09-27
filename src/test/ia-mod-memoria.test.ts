// Memoria de PulseBot: sabe qué está aplicado de verdad y recuerda lo hablado sin llenar el almacenamiento.
import { describe, expect, it } from "vitest";
import { estadoCambiosTexto, sistemaIaMod, textoParaResumir } from "../../supabase/functions/_shared/ia-mod";
import { mantenerMemoria } from "../../supabase/functions/ia-modificaciones/agente";
import { crearDb } from "./helpers/fake-db";

describe("estado real de los cambios", () => {
  it("sin pendientes lo dice claro, con hora y estado de cada cambio", () => {
    const t = estadoCambiosTexto([
      { summary: 'Ajustes de "LEAD GENERATION"', status: "applied", created_at: "2026-09-27T23:27:00Z" },
      { summary: "Variante B editada", status: "undone", created_at: "2026-09-27T23:25:00Z" },
    ]);
    expect(t).toMatch(/No hay ningún cambio pendiente/);
    expect(t).toMatch(/01:27 · APLICADO · Ajustes de "LEAD GENERATION"/);
    expect(t).toMatch(/DESHECHO · Variante B editada/);
  });
  it("con pendientes los cuenta", () => {
    expect(estadoCambiosTexto([{ summary: "x", status: "pending", created_at: "2026-09-27T23:27:00Z" }])).toMatch(/Hay 1 cambio\(s\) PENDIENTE/);
  });
  it("el prompt lleva el estado real y el resumen, y prohíbe el 'si no lo has confirmado'", () => {
    const s = sistemaIaMod({ nombre: "", empresa: "X", email: "x@x.es", notas: "", instruccionesRespuestas: "", skills: "", enlaceReserva: "", campanas: [], hoy: "hoy",
      estadoCambios: "No hay ningún cambio pendiente", resumen: "- Se repartieron 76 cuentas en LEADGEN y PYMES" });
    expect(s).toMatch(/ESTADO REAL DE LOS CAMBIOS/);
    expect(s).toMatch(/nunca digas "si no lo has confirmado"/);
    expect(s).toMatch(/Se repartieron 76 cuentas/);
  });
  it("texto para resumir: compacto, con lo que se hizo en cada turno", () => {
    const t = textoParaResumir([
      { role: "user", content: "reparte las cuentas", cards: [] },
      { role: "assistant", content: "Hecho", cards: [{ summary: 'Poner "LEADGEN" en 38 cuentas' }] },
    ]);
    expect(t).toBe('Equipo: reparte las cuentas\nPulseBot: Hecho [hecho: Poner "LEADGEN" en 38 cuentas]');
  });
});

describe("almacenamiento: nunca se borra lo que no está resumido", () => {
  const mensajes = (n: number) => Array.from({ length: n }, (_, i) => ({
    id: `m${i}`, client_user_id: "c", role: i % 2 ? "assistant" : "user", content: `mensaje ${i}`, cards: [],
    created_at: new Date(Date.UTC(2026, 8, 1) + i * 60000).toISOString(),
  }));
  it("sin resumen (sin IA) no borra nada aunque pase de 300", async () => {
    const db = crearDb({ ia_mod_messages: mensajes(320), ia_mod_notes: [] });
    await mantenerMemoria(db, "", "c");
    expect(db.t.ia_mod_messages).toHaveLength(320);
  });
  it("con resumen hasta un punto, borra sólo los más viejos ya resumidos y deja 300", async () => {
    const msgs = mensajes(320);
    const db = crearDb({ ia_mod_messages: msgs, ia_mod_notes: [{ client_user_id: "c", resumen: "…", resumen_hasta: msgs[250].created_at }] });
    await mantenerMemoria(db, "", "c");
    expect(db.t.ia_mod_messages).toHaveLength(300);
    expect(db.t.ia_mod_messages.some((m: any) => m.id === "m0")).toBe(false);
    expect(db.t.ia_mod_messages.some((m: any) => m.id === "m20")).toBe(true);
  });
});
