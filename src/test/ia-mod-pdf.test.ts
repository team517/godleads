import { beforeEach, describe, expect, it } from "vitest";
import { ejecutar } from "../../supabase/functions/ia-modificaciones/agente";
import { IA_MOD_TOOLS, sistemaIaMod } from "../../supabase/functions/_shared/ia-mod";
import { MAX_PAGINAS_PDF, TROZO_PAGINAS, prepararDocumento, trozos } from "@/lib/ia-mod-csv";
import { crearDb } from "./helpers/fake-db";

/* PulseBot acepta PDF adjuntos: el navegador saca el texto de cada página, se sube como un adjunto
   de tipo "documento" y el bot lo lee por páginas con ver_archivo. */

describe("adjuntar un PDF en Modificaciones IA", () => {
  it("las páginas con texto se quedan, limpias y numeradas; las vacías no", () => {
    const d = prepararDocumento(["  Propuesta   comercial \n\n  OnePulso  ", "", "Precios:\n 15 reuniones   al mes"]);
    if ("error" in d) throw new Error(d.error);
    expect(d.kind).toBe("documento");
    expect(d.headers).toEqual(["pagina", "texto"]);
    expect(d.rows).toEqual([
      { pagina: "1", texto: "Propuesta comercial\nOnePulso" },
      { pagina: "3", texto: "Precios:\n15 reuniones al mes" },
    ]);
    expect(d.descartadas).toBe(1);
    expect(d.total).toBe(3);
    expect(d.recortado).toBeUndefined();
  });

  it("un PDF escaneado (sin texto) se avisa en vez de subirse vacío", () => {
    const d = prepararDocumento(["", "   ", "\n"]);
    expect("error" in d && d.error).toMatch(/escaneado/);
  });

  it("un PDF muy largo se corta y se dice", () => {
    const d = prepararDocumento(Array.from({ length: 200 }, (_, i) => `Página ${i + 1} ` + "x".repeat(9000)));
    if ("error" in d) throw new Error(d.error);
    expect(d.rows.length).toBeLessThanOrEqual(MAX_PAGINAS_PDF);
    expect(d.rows.reduce((n, r) => n + r.texto.length, 0)).toBeLessThanOrEqual(300_000);
    expect(d.recortado).toBe(true);
    // se sube en peticiones pequeñas
    expect(Math.max(...trozos(d.rows, TROZO_PAGINAS).map((t) => JSON.stringify(t).length))).toBeLessThan(60_000);
  });
});

const CLIENTE = { id: "cli-1", email: "info@acme.es", nombre: "", empresa: "Acme", instrucciones: "", skills: "", enlace: "" };
const paginas = Array.from({ length: 12 }, (_, i) => ({ pagina: String(i + 1), texto: `Texto de la página ${i + 1}. ` + "contenido ".repeat(300) }));

describe("PulseBot lee el PDF por páginas", () => {
  let ctx: any;
  beforeEach(() => {
    const db = crearDb({
      campaigns: [{ id: "camp-1", user_id: "cli-1", name: "CAMPAÑA", status: "draft" }],
      ia_mod_uploads: [
        { id: "pdf-1", client_user_id: "cli-1", filename: "propuesta.pdf", kind: "documento", headers: ["pagina", "texto"], rows: paginas, row_count: 12, discarded: 0 },
        { id: "pdf-ajeno", client_user_id: "otro", filename: "x.pdf", kind: "documento", headers: ["pagina", "texto"], rows: paginas, row_count: 12, discarded: 0 },
      ],
    });
    ctx = { db, cliente: CLIENTE, autor: "hello@onepulso.blog", tarjetas: [] };
  });

  it("devuelve el texto desde el principio y dice por dónde seguir", async () => {
    const r: any = await ejecutar(ctx, "ver_archivo", { upload_id: "pdf-1" });
    expect(r.tipo).toBe("documento");
    expect(r.paginas_con_texto).toBe(12);
    expect(r.paginas[0]).toMatchObject({ pagina: "1" });
    expect(r.paginas[0].texto).toContain("Texto de la página 1.");
    expect(r.paginas.reduce((n: number, p: any) => n + p.texto.length, 0)).toBeLessThanOrEqual(14000);
    expect(r.quedan_paginas).toBeGreaterThan(0);
    const r2: any = await ejecutar(ctx, "ver_archivo", { upload_id: "pdf-1", desde: r.siguiente_desde, cuantas: 50 });
    expect(r2.paginas[0].pagina).toBe(String(r.siguiente_desde + 1));
  });

  it("leyéndolo por tramos se llega al final sin saltarse ni repetir ninguna página", async () => {
    const vistas: string[] = [];
    let desde = 0;
    for (let i = 0; i < 20; i++) {
      const r: any = await ejecutar(ctx, "ver_archivo", { upload_id: "pdf-1", desde });
      vistas.push(...r.paginas.map((p: any) => p.pagina));
      if (r.fin_del_documento) break;
      desde = r.siguiente_desde;
    }
    expect(vistas).toEqual(paginas.map((p) => p.pagina));
  });

  it("de un PDF no se importan leads y no se lee el de otro cliente", async () => {
    await expect(ejecutar(ctx, "importar_leads", { upload_id: "pdf-1", campaign_id: "camp-1" })).rejects.toThrow(/documento PDF/);
    await expect(ejecutar(ctx, "ver_archivo", { upload_id: "pdf-ajeno" })).rejects.toThrow(/no es de este cliente/);
  });

  it("el bot sabe que tiene que leer el PDF antes de contestar", () => {
    const herramienta = IA_MOD_TOOLS.find((t: any) => t.function.name === "ver_archivo") as any;
    expect(herramienta.function.description).toMatch(/PDF/);
    expect(sistemaIaMod({ nombre: "", empresa: "Acme", email: "info@acme.es", notas: "", instruccionesRespuestas: "", skills: "", enlaceReserva: "", campanas: [], hoy: "hoy" } as any, false)).toMatch(/DOCUMENTOS PDF ADJUNTOS/);
  });
});
