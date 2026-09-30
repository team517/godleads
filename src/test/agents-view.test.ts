import { describe, expect, it } from "vitest";
import { curvaActividad, filtrarAgentes, serieDiaria, tarjetasAsistente, tarjetasRespuesta } from "@/lib/agents-view";

const AHORA = new Date(2026, 8, 30, 12, 0);
const dia = (atras: number, h = 10) => new Date(2026, 8, 30 - atras, h, 0).toISOString();

describe("Agentes IA", () => {
  it("la gráfica cuenta la actividad real por día, hoy a la derecha", () => {
    const s = serieDiaria([dia(0), dia(0, 23), dia(1), dia(13), dia(14), dia(30)], AHORA);
    expect(s).toHaveLength(14);
    expect(s[13]).toBe(2);
    expect(s[12]).toBe(1);
    expect(s[0]).toBe(1);
    expect(s.reduce((a, b) => a + b, 0)).toBe(4); // lo de hace 14 y 30 días no entra
  });

  it("un agente de respuestas enseña lo que ha enviado y los borradores pendientes", () => {
    const [c] = tarjetasRespuesta(
      [{ id: "r1", name: "Reuniones", is_active: true, reply_mode: "draft", primary_goal: "book_meeting", category_mode: "specific", categories: ["Interesado"] }],
      [
        { rule_id: "r1", status: "sent", created_at: dia(0) },
        { rule_id: "r1", status: "draft", created_at: dia(1) },
        { rule_id: "r1", status: "draft", created_at: dia(2) },
        { rule_id: "otro", status: "sent", created_at: dia(0) },
      ],
      AHORA,
    );
    expect(c.status).toBe("active");
    expect(c.metricA).toEqual({ value: 1, label: "Enviadas · 14 días" });
    expect(c.metricB).toEqual({ value: 2, label: "Borradores" });
    expect(c.tags).toEqual(["Borradores", "Interesado"]);
    expect(c.description).toMatch(/Consigue reuniones/);
  });

  it("un asistente sin etiquetas es un borrador (no se usa en ningún buzón)", () => {
    const [a, b] = tarjetasAsistente(
      [{ id: "p1", name: "Ventas", company_info: "Vendemos X", tags: ["LEADGEN", "PYMES"] }, { id: "p2", name: "Nuevo", tags: [] }],
      { LEADGEN: 38, PYMES: 38 },
    );
    expect(a.status).toBe("active");
    expect(a.metricB).toEqual({ value: 76, label: "Buzones" });
    expect(b.status).toBe("draft");
    expect(b.series.every((v) => v === 0)).toBe(true);
  });

  it("buscar y filtrar por tipo y estado", () => {
    const cards = [
      ...tarjetasRespuesta([{ id: "r1", name: "Reuniones", is_active: false }], [], AHORA),
      ...tarjetasAsistente([{ id: "p1", name: "Soporte", tags: ["X"] }], {}),
    ];
    expect(filtrarAgentes(cards, { q: "", kind: "all", status: "all" })).toHaveLength(2);
    expect(filtrarAgentes(cards, { q: "reun", kind: "all", status: "all" }).map((c) => c.id)).toEqual(["r1"]);
    expect(filtrarAgentes(cards, { q: "", kind: "assistant", status: "all" }).map((c) => c.id)).toEqual(["p1"]);
    expect(filtrarAgentes(cards, { q: "", kind: "all", status: "paused" }).map((c) => c.id)).toEqual(["r1"]);
  });

  it("la curva sin actividad es plana y con actividad sube", () => {
    expect(curvaActividad([0, 0, 0]).vacia).toBe(true);
    const c = curvaActividad([0, 5, 1], 100, 50, 5);
    expect(c.vacia).toBe(false);
    expect(c.line.startsWith("M0,45")).toBe(true);
    expect(c.area.endsWith("Z")).toBe(true);
  });
});
