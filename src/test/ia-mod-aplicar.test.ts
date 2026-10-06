// "Cuando le digas que aplique algo, que lo aplique de verdad" (dueño, 06-10-2026).
// Pruebas de: confirmar por texto, comprobar lo guardado releyendo, el texto de después sale del resultado
// real, y el cambio de un mensaje con variantes A/B. El código del servidor se ejecuta contra la BD simulada.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  aplicarPorTexto, confirmarCambio, contarEscritura, conversar, ejecutar, textoFinal, type Turno,
} from "../../supabase/functions/ia-modificaciones/agente";
import {
  diferencias, dichoAplicado, enlacesATexto, igualesValor, intencionDeConfirmar, limpiarMarcas, mensajeResultado, ordenDeAplicar, parseVersiones,
} from "../../supabase/functions/_shared/ia-mod";
import { esOrdenDeAplicar } from "../lib/chatbot-intent";
import { crearDb } from "./helpers/fake-db";

describe("confirmación escrita: qué cuenta como 'aplícalo'", () => {
  it.each([
    "sí", "Sí, aplícalo", "aplícalo", "aplica", "hazlo", "ok, hazlo", "dale", "Dale ya", "sí, aplica los cambios", "vale, confírmalo",
    "adelante", "perfecto, aplícalo", "si hazlo por favor", "ok aplica", "de acuerdo", "sí, aplícalo todo",
  ])("%s → confirmar", (t) => expect(intencionDeConfirmar(t)).toBe("confirmar"));

  it.each([
    "cancela", "cancélalo", "no lo apliques", "mejor no, olvídalo", "descártalo", "no, cancela eso",
  ])("%s → cancelar", (t) => expect(intencionDeConfirmar(t)).toBe("cancelar"));

  it.each([
    "no", "sí, pero cambia el asunto", "aplícalo y además pon la firma de Nacho", "vale, ¿y la variante B?", "hola",
    "sí quiero que cambies el primer mensaje por uno más corto y directo", "dale la vuelta al segundo mensaje", "", "no sé",
  ])("%s → no es una confirmación", (t) => expect(intencionDeConfirmar(t)).toBeNull());

  it("ordenDeAplicar: autoriza confirmar_cambio aunque venga con más texto", () => {
    expect(ordenDeAplicar("aplica el de la variante B y deja el otro")).toBe(true);
    expect(ordenDeAplicar("confirma el cambio de ajustes")).toBe(true);
    expect(ordenDeAplicar("cambia el asunto del segundo mensaje")).toBe(false);
    expect(ordenDeAplicar("no lo apliques todavía")).toBe(false);
  });

  it("el chatbot flotante manda 'aplícalo' a PulseBot aunque lo anterior fuese el consultor", () => {
    expect(esOrdenDeAplicar("aplícalo")).toBe(true);
    expect(esOrdenDeAplicar("sí, hazlo")).toBe(true);
    expect(esOrdenDeAplicar("no lo apliques")).toBe(false);
    expect(esOrdenDeAplicar("¿qué te parece mi campaña y cómo la mejoro con una frase que aplique mejor al sector de la construcción?")).toBe(false);
  });
});

describe("dar algo por hecho", () => {
  it("detecta lo que se dice como hecho", () => {
    for (const t of ["He cambiado el asunto del paso 2.", "Hecho. Ya tienes la firma.", "Listo, queda aplicado.", "Ya está aplicado en las dos campañas", "Lo he actualizado en la B"]) {
      expect(dichoAplicado(t), t).toBe(true);
    }
  });
  it("no se confunde con negaciones ni con propuestas", () => {
    for (const t of ["No he cambiado nada todavía.", "Queda pendiente de Confirmar.", "¿Quieres que lo aplique?", "Puedo cambiar el asunto si me dices cuál."]) {
      expect(dichoAplicado(t), t).toBe(false);
    }
  });
});

describe("comprobar lo guardado", () => {
  it("compara textos normalizados, arrays y objetos", () => {
    expect(igualesValor("a\r\nb ", "a\nb")).toBe(true);
    expect(igualesValor(["x", "y"], ["y", "x"], true)).toBe(true);
    expect(igualesValor(["x", "y"], ["y", "x"])).toBe(false);
    expect(igualesValor([{ a: 1, b: "t" }], [{ b: "t", a: 1 }])).toBe(true);
    expect(igualesValor(null, undefined)).toBe(true);
    expect(igualesValor(5, 6)).toBe(false);
  });
  it("diferencias dice qué campo no quedó", () => {
    expect(diferencias({ subject: "A", body: "B" }, { subject: "A", body: "B" })).toEqual([]);
    expect(diferencias({ subject: "A", body: "B" }, { subject: "A", body: "viejo" })[0]).toMatch(/^body: se quería B y hay viejo/);
    expect(diferencias({ subject: "A" }, null)).toEqual(["la fila ya no existe"]);
  });
  it("mensajeResultado sale del resultado real", () => {
    expect(mensajeResultado([{ summary: "Mensaje 2 editado", status: "applied", detalle: "releído" }])).toBe("Aplicado y comprobado: Mensaje 2 editado (releído).");
    const m = mensajeResultado([
      { summary: "Cambio 1", status: "applied" },
      { summary: "Cambio 2", status: "failed", error: "la campaña ya no existe" },
    ]);
    expect(m).toMatch(/- Aplicado y comprobado: Cambio 1\./);
    expect(m).toMatch(/- NO se ha aplicado: Cambio 2\. Motivo: la campaña ya no existe\./);
    expect(m).toMatch(/Lo demás sí está aplicado\./);
    expect(mensajeResultado([{ summary: "X", status: "failed", error: "e" }])).toMatch(/No se ha cambiado nada/);
    expect(mensajeResultado([{ summary: "X", status: "cancelled" }])).toMatch(/Cancelado: X\. No se ha tocado nada\./);
    expect(mensajeResultado([])).toMatch(/ningún cambio pendiente/);
  });
});

describe("texto plano: sin markdown ni enlaces perdidos", () => {
  it("quita ** y # pero deja el resto", () => {
    expect(limpiarMarcas("Hola **Juan**, vi __tu web__.\n# Título\nSaludos")).toBe("Hola Juan, vi tu web.\nTítulo\nSaludos");
    expect(limpiarMarcas("{{first_name}} y {{company_name}}")).toBe("{{first_name}} y {{company_name}}");
  });
  it("los enlaces <a> no se pierden al pasar a texto", () => {
    expect(enlacesATexto('Reserva <a href="https://calendly.com/x/30min">aquí</a>.')).toBe("Reserva aquí (https://calendly.com/x/30min).");
    expect(enlacesATexto('<a href="https://x.es">https://x.es</a>')).toBe("https://x.es");
  });
});

describe("versiones de un mensaje", () => {
  it("parseVersiones", () => {
    const hay = [0, 1, 2];
    expect(parseVersiones("todas", hay)).toEqual([0, 1, 2]);
    expect(parseVersiones("A,C", hay)).toEqual([0, 2]);
    expect(parseVersiones("b", hay)).toEqual([1]);
    expect(parseVersiones("D", hay)).toBeNull();
    expect(parseVersiones("", hay)).toBeNull();
  });
});

/* ── Servidor contra la BD simulada ────────────────────────────────────────────────────── */

const CLI = "cli-1";
const CLIENTE = { id: CLI, email: "nacho@publiup.com", nombre: "", empresa: "Publiup", instrucciones: "", skills: "", enlace: "" };

function montar() {
  const db = crearDb({
    campaigns: [
      { id: "c-borrador", user_id: CLI, name: "Automatización", status: "draft", send_start_hour: 9, send_end_hour: 18, ab_test_enabled: true },
      { id: "c-activa", user_id: CLI, name: "Activa", status: "active", send_start_hour: 9, send_end_hour: 18, daily_limit: 100 },
    ],
    campaign_steps: [
      { id: "s-ab", campaign_id: "c-borrador", step_order: 1, subject: "idea", body: "Texto viejo A", delay_days: 0, created_at: "1", variants: [{ subject: "idea B", body: "Texto viejo B", tag_filter: null }], variants_off: [] },
      { id: "s-sin", campaign_id: "c-borrador", step_order: 2, subject: "", body: "Seguimiento viejo", delay_days: 2, created_at: "2", variants: [], variants_off: [] },
    ],
  });
  const ctx: any = { db, cliente: CLIENTE, autor: "nacho@publiup.com", tarjetas: [], turno: { hechas: 0, pendientes: 0, fallos: [] }, ordenAplicar: false };
  return { db, ctx };
}

/** Hace que las escrituras en una tabla "funcionen" (sin error) pero no guarden nada: el caso que antes se daba por bueno. */
function noPersistir(db: any, tabla: string) {
  const from = db.from.bind(db);
  db.from = (n: string) => {
    const q = from(n);
    if (n === tabla) { const up = q.update.bind(q); q.update = () => up({}); }
    return q;
  };
}

describe("editar_mensaje con variantes A/B", () => {
  it("si hay variantes encendidas y no dices a cuáles, no toca nada y lo pide", async () => {
    const { db, ctx } = montar();
    const r: any = await ejecutar(ctx, "editar_mensaje", { step_id: "s-ab", cuerpo: "Nuevo texto" });
    expect(r.ok).toBe(false);
    expect(r.aclaracion_necesaria).toMatch(/variantes B ENCENDIDAS/);
    expect(db.t.campaign_steps[0].body).toBe("Texto viejo A");
    expect(db.t.ia_mod_changes || []).toHaveLength(0);
  });

  it("versiones 'todas': cambia la A y la B y lo comprueba", async () => {
    const { db, ctx } = montar();
    const r: any = await ejecutar(ctx, "editar_mensaje", { step_id: "s-ab", cuerpo: "Nuevo texto", versiones: "todas" });
    expect(r).toMatchObject({ ok: true, verificado: true, versiones_cambiadas: ["A", "B"] });
    expect(db.t.campaign_steps[0].body).toBe("Nuevo texto");
    expect(db.t.campaign_steps[0].variants[0]).toMatchObject({ body: "Nuevo texto", subject: "idea B", tag_filter: null });
    const ch = db.t.ia_mod_changes[0];
    expect(ch).toMatchObject({ kind: "step_update", status: "applied" });
    expect(ch.before.variants[0].body).toBe("Texto viejo B");   // para poder deshacer también la B
  });

  it("sólo la B: la A no se toca", async () => {
    const { db, ctx } = montar();
    const r: any = await ejecutar(ctx, "editar_mensaje", { step_id: "s-ab", asunto: "Otro asunto", versiones: "B" });
    expect(r.versiones_cambiadas).toEqual(["B"]);
    expect(db.t.campaign_steps[0].subject).toBe("idea");
    expect(db.t.campaign_steps[0].variants[0].subject).toBe("Otro asunto");
  });

  it("sin variantes sigue siendo un cambio directo de la A", async () => {
    const { db, ctx } = montar();
    const r: any = await ejecutar(ctx, "editar_mensaje", { step_id: "s-sin", cuerpo: "**Hola** nuevo" });
    expect(r).toMatchObject({ ok: true, verificado: true, versiones_cambiadas: ["A"] });
    expect(db.t.campaign_steps[1].body).toBe("Hola nuevo");           // nada de ** literales
  });

  it("si la base de datos no guarda lo pedido, falla con el motivo y queda registrado como failed", async () => {
    const { db, ctx } = montar();
    noPersistir(db, "campaign_steps");
    await expect(ejecutar(ctx, "editar_mensaje", { step_id: "s-sin", cuerpo: "Nuevo" })).rejects.toThrow(/No se guardó bien/);
    expect(db.t.campaign_steps[1].body).toBe("Seguimiento viejo");
    expect(db.t.ia_mod_changes).toHaveLength(1);
    expect(db.t.ia_mod_changes[0]).toMatchObject({ status: "failed", kind: "step_update" });
    expect(db.t.ia_mod_changes[0].after.error).toMatch(/No se guardó bien/);
  });

  it("editar_variante A se redirige al propio mensaje", async () => {
    const { db, ctx } = montar();
    const r: any = await ejecutar(ctx, "editar_variante", { step_id: "s-sin", letra: "A", cuerpo: "Por la A" });
    expect(r.ok).toBe(true);
    expect(db.t.campaign_steps[1].body).toBe("Por la A");
  });

  it("editar_variante comprueba lo guardado", async () => {
    const { db, ctx } = montar();
    const r: any = await ejecutar(ctx, "editar_variante", { step_id: "s-ab", letra: "B", cuerpo: "Cuerpo B nuevo" });
    expect(r).toMatchObject({ ok: true, verificado: true, letra: "B" });
    expect(db.t.campaign_steps[0].variants[0].body).toBe("Cuerpo B nuevo");
    const { db: db2, ctx: ctx2 } = montar();
    noPersistir(db2, "campaign_steps");
    await expect(ejecutar(ctx2, "editar_variante", { step_id: "s-ab", letra: "B", cuerpo: "Cuerpo B nuevo" })).rejects.toThrow(/No se guardó bien/);
    expect(db2.t.ia_mod_changes[0].status).toBe("failed");
  });
});

describe("ajustes de campaña: se comprueban y un pendiente sólo se aplica al confirmar", () => {
  it("campaña activa: queda pendiente (NO aplicado) y confirmarCambio lo aplica y lo comprueba", async () => {
    const { db, ctx } = montar();
    const r: any = await ejecutar(ctx, "ajustar_campana", { campaign_id: "c-activa", limite_diario: 50 });
    expect(r.pendiente).toBe(true);
    expect(r.mensaje).toMatch(/NO aplicado todavía/);
    expect(db.t.campaigns[1].daily_limit).toBe(100);
    const ch = db.t.ia_mod_changes[0];
    const c = await confirmarCambio(db, ch);
    expect(c).toMatchObject({ status: "applied" });
    expect(c.detalle).toMatch(/releído/);
    expect(db.t.campaigns[1].daily_limit).toBe(50);
    expect(ch.status).toBe("applied");
    expect(ch.before).toEqual({ daily_limit: 100 });
  });

  it("si la escritura no se queda, no se marca applied: failed, con el motivo, y se restaura", async () => {
    const { db, ctx } = montar();
    await ejecutar(ctx, "ajustar_campana", { campaign_id: "c-activa", limite_diario: 50 });
    noPersistir(db, "campaigns");
    const ch = db.t.ia_mod_changes[0];
    const c = await confirmarCambio(db, ch);
    expect(c.status).toBe("failed");
    expect(c.error).toMatch(/No quedó guardado como se pidió/);
    expect(ch.status).toBe("failed");
    expect(db.t.campaigns[1].daily_limit).toBe(100);
  });

  it("un cambio ya resuelto no se vuelve a aplicar", async () => {
    const { db, ctx } = montar();
    await ejecutar(ctx, "ajustar_campana", { campaign_id: "c-activa", limite_diario: 50 });
    const ch = db.t.ia_mod_changes[0];
    await confirmarCambio(db, ch);
    const otra = await confirmarCambio(db, ch);
    expect(otra.status).toBe("applied");
    expect(otra.error).toMatch(/ya no está pendiente/);
  });

  it("campaña en borrador: se aplica ya y se comprueba (verificado:true)", async () => {
    const { db, ctx } = montar();
    const r: any = await ejecutar(ctx, "ajustar_campana", { campaign_id: "c-borrador", hora_inicio: 10, hora_fin: 17 });
    expect(r).toMatchObject({ hecho: true, verificado: true });
    expect(db.t.campaigns[0]).toMatchObject({ send_start_hour: 10, send_end_hour: 17 });
  });
});

describe("'aplícalo' escrito aplica los pendientes de la última respuesta (mismo camino que el botón)", () => {
  async function conPendiente() {
    const { db, ctx } = montar();
    const r: any = await ejecutar(ctx, "ajustar_campana", { campaign_id: "c-activa", limite_diario: 50 });
    db.t.ia_mod_messages = [
      { id: "m1", client_user_id: CLI, role: "user", content: "baja el límite a 50", cards: [], created_at: new Date(Date.now() - 20_000).toISOString() },
      { id: "m2", client_user_id: CLI, role: "assistant", content: "Queda pendiente de Confirmar.", cards: ctx.tarjetas, created_at: new Date(Date.now() - 10_000).toISOString() },
    ];
    return { db, ctx, changeId: r.change_id as string };
  }

  it("confirmar: aplica, comprueba y el texto lo dice con el resultado real", async () => {
    const { db, changeId } = await conPendiente();
    const r = await aplicarPorTexto(db, CLIENTE, "confirmar");
    expect(r).not.toBeNull();
    expect(r!.estados).toEqual({ [changeId]: "applied" });
    expect(r!.texto).toMatch(/^Aplicado y comprobado: Ajustes de "Activa"/);
    expect(r!.tarjetas[0]).toMatchObject({ type: "cambio", change_id: changeId });
    expect(db.t.campaigns[1].daily_limit).toBe(50);
  });

  it("si falla no dice que lo aplicó", async () => {
    const { db, changeId } = await conPendiente();
    noPersistir(db, "campaigns");
    const r = await aplicarPorTexto(db, CLIENTE, "confirmar");
    expect(r!.estados).toEqual({ [changeId]: "failed" });
    expect(r!.texto).toMatch(/^NO se ha aplicado: /);
    expect(r!.texto).not.toMatch(/Aplicado y comprobado/);
    expect(r!.tarjetas).toHaveLength(0);
  });

  it("cancelar: no toca nada", async () => {
    const { db, changeId } = await conPendiente();
    const r = await aplicarPorTexto(db, CLIENTE, "cancelar");
    expect(r!.estados).toEqual({ [changeId]: "cancelled" });
    expect(db.t.campaigns[1].daily_limit).toBe(100);
    expect(db.t.ia_mod_changes[0].status).toBe("cancelled");
  });

  it("sin pendientes en la última respuesta (o respuesta vieja), no hace nada: lo atiende la IA", async () => {
    const { db } = await conPendiente();
    db.t.ia_mod_messages[1].cards = [];
    expect(await aplicarPorTexto(db, CLIENTE, "confirmar")).toBeNull();
    const { db: db2 } = await conPendiente();
    db2.t.ia_mod_messages[1].created_at = new Date(Date.now() - 20 * 3600_000).toISOString();
    expect(await aplicarPorTexto(db2, CLIENTE, "confirmar")).toBeNull();
    expect(db2.t.campaigns[1].daily_limit).toBe(100);
  });
});

describe("confirmar_cambio (herramienta de la IA)", () => {
  it("sin orden de aplicar del usuario, la IA no puede confirmar", async () => {
    const { db, ctx } = montar();
    const r: any = await ejecutar(ctx, "ajustar_campana", { campaign_id: "c-activa", limite_diario: 50 });
    const x: any = await ejecutar(ctx, "confirmar_cambio", { change_id: r.change_id });
    expect(x.error).toMatch(/no ha pedido aplicar/);
    expect(db.t.campaigns[1].daily_limit).toBe(100);
  });
  it("con orden de aplicar sí, y devuelve ok sólo si se comprobó", async () => {
    const { db, ctx } = montar();
    const r: any = await ejecutar(ctx, "ajustar_campana", { campaign_id: "c-activa", limite_diario: 50 });
    ctx.ordenAplicar = true;
    const x: any = await ejecutar(ctx, "confirmar_cambio", { change_id: r.change_id });
    expect(x).toMatchObject({ ok: true, verificado: true });
    expect(db.t.campaigns[1].daily_limit).toBe(50);
    const otra: any = await ejecutar(ctx, "confirmar_cambio", { change_id: r.change_id });
    expect(otra.error).toMatch(/no está pendiente/);
  });
});

describe("el texto final nunca da por aplicado lo que no lo está", () => {
  const turno = (p: Partial<Turno> = {}): Turno => ({ hechas: 0, pendientes: 0, fallos: [], ...p });
  it("respuesta vacía: sale del resultado real, no un 'Hecho.' a ciegas", () => {
    expect(textoFinal("", turno(), [])).toBe("No he hecho ningún cambio en este turno.");
    expect(textoFinal("", turno({ hechas: 1 }), [{ type: "cambio", summary: "Mensaje 2 editado" }])).toBe("Aplicado y comprobado: Mensaje 2 editado.");
    expect(textoFinal("", turno({ pendientes: 1 }), [{ type: "pendiente", summary: "Borrar el mensaje 3" }])).toMatch(/Pendiente de Confirmar \(aún NO aplicado\)/);
    expect(textoFinal("", turno({ fallos: ["editar mensaje: No se guardó bien"] }), [])).toMatch(/NO se ha podido aplicar: editar mensaje/);
  });
  it("si la IA dice 'hecho' y hubo un fallo, se añade la verdad", () => {
    const t = textoFinal("Hecho, he cambiado el asunto.", turno({ fallos: ["editar mensaje: la fila ya no existe"] }), []);
    expect(t).toMatch(/Ojo, esto NO se ha podido aplicar: editar mensaje: la fila ya no existe/);
  });
  it("si la IA dice 'hecho' y sólo hay un pendiente, se avisa de que sigue pendiente", () => {
    expect(textoFinal("Listo, aplicado.", turno({ pendientes: 1 }), [])).toMatch(/sigue PENDIENTE/);
    expect(textoFinal("Listo, aplicado.", turno({ hechas: 1 }), [])).toBe("Listo, aplicado.");
  });
  it("contarEscritura: error, pendiente y ok; un fallo reintentado con éxito deja de contar", () => {
    const t = turno();
    contarEscritura(t, "ver_campanas", { ok: true });
    expect(t).toEqual({ hechas: 0, pendientes: 0, fallos: [] });
    contarEscritura(t, "editar_mensaje", { error: "No se guardó" });
    contarEscritura(t, "ajustar_campana", { pendiente: true });
    expect(t.fallos).toHaveLength(1); expect(t.pendientes).toBe(1);
    contarEscritura(t, "editar_mensaje", { ok: true, verificado: true });
    expect(t.hechas).toBe(1); expect(t.fallos).toHaveLength(0);
  });
});

describe("conversar: la IA que dice 'hecho' sin haber tocado nada se corrige", () => {
  const original = globalThis.fetch;
  afterEach(() => { globalThis.fetch = original; vi.restoreAllMocks(); });
  beforeEach(() => { /* cada prueba monta su propio fetch */ });

  function guion(respuestas: any[]) {
    const peticiones: any[] = [];
    globalThis.fetch = (async (_url: any, init: any) => {
      peticiones.push(JSON.parse(init.body));
      const r = respuestas.shift();
      return new Response(JSON.stringify({ choices: [{ message: r }] }), { status: 200 });
    }) as any;
    return peticiones;
  }

  it("dice 'he cambiado…' sin llamar a ninguna herramienta: se le avisa y rectifica", async () => {
    const { db } = montar();
    db.t.ia_mod_messages = [{ id: "u1", client_user_id: CLI, role: "user", content: "pon la firma de Nacho en el mensaje 2", cards: [], created_at: new Date().toISOString() }];
    const peticiones = guion([
      { content: "Hecho, he cambiado la firma en el mensaje 2." },
      { content: "Perdona, todavía no he cambiado nada. ¿Lo hago ahora?" },
    ]);
    const r = await conversar(db, "k", CLIENTE, "nacho@publiup.com");
    expect(peticiones).toHaveLength(2);
    expect(peticiones[1].messages.at(-1).content).toMatch(/AVISO DEL SISTEMA/);
    expect(r.texto).toBe("Perdona, todavía no he cambiado nada. ¿Lo hago ahora?");
  });

  it("si insiste y hubo un error de la herramienta, el usuario lee el error aunque la IA diga 'listo'", async () => {
    const { db } = montar();
    db.t.ia_mod_messages = [{ id: "u1", client_user_id: CLI, role: "user", content: "cambia el cuerpo del mensaje 1", cards: [], created_at: new Date().toISOString() }];
    guion([
      { content: "", tool_calls: [{ id: "t1", function: { name: "editar_mensaje", arguments: JSON.stringify({ step_id: "no-existe", cuerpo: "X" }) } }] },
      { content: "Listo, cambiado." },
      { content: "Listo, cambiado." },
    ]);
    const r = await conversar(db, "k", CLIENTE, "nacho@publiup.com");
    expect(r.texto).toMatch(/Listo, cambiado\./);
    expect(r.texto).toMatch(/Ojo, esto NO se ha podido aplicar: editar mensaje: Ese mensaje no existe/);
  });

  it("cambio real + 'listo': no se toca el texto", async () => {
    const { db } = montar();
    db.t.ia_mod_messages = [{ id: "u1", client_user_id: CLI, role: "user", content: "cambia el seguimiento", cards: [], created_at: new Date().toISOString() }];
    const peticiones = guion([
      { content: "", tool_calls: [{ id: "t1", function: { name: "editar_mensaje", arguments: JSON.stringify({ step_id: "s-sin", cuerpo: "Seguimiento nuevo" }) } }] },
      { content: "Hecho: mensaje 2 cambiado." },
    ]);
    const r = await conversar(db, "k", CLIENTE, "nacho@publiup.com");
    expect(peticiones).toHaveLength(2);
    expect(r.texto).toBe("Hecho: mensaje 2 cambiado.");
    expect(db.t.campaign_steps[1].body).toBe("Seguimiento nuevo");
    expect(r.tarjetas.some((t) => t.type === "cambio")).toBe(true);
  });
});
