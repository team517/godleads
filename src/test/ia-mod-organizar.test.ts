// PulseBot organiza cuentas (etiquetas, conectar a campañas, slow ramp) y ajusta campañas,
// con el código REAL del servidor sobre una base de datos en memoria que calcula las cuentas de
// cada campaña con la misma regla que el motor (a mano ∪ etiquetas exactas de cuentas conectadas).
import { describe, expect, it } from "vitest";
import { aplicarPendiente, deshacer, ejecutar } from "../../supabase/functions/ia-modificaciones/agente";
import { MARCA_IDEA, puedeSugerir, seleccionarCuentas, sistemaIaMod } from "../../supabase/functions/_shared/ia-mod";
import { crearDb } from "./helpers/fake-db";

const CLI = "cli-1";
const CLIENTE = { id: CLI, email: "info@seoinnova.es", nombre: "", empresa: "Seo Innova", instrucciones: "", skills: "", enlace: "" };

function montar() {
  const cuentas = Array.from({ length: 6 }, (_, i) => ({
    id: `acc-${i}`, user_id: CLI, email: `buzon${i}@seo.es`, status: "connected", tags: ["campaña 1"],
    warmup_enabled: false, warmup_increment: null, warmup_limit: null, warmup_day: null, warmup_started_at: null,
  }));
  const campaigns = [
    { id: "grande", user_id: CLI, name: "GRANDE", status: "active", account_tags: ["campaña 1"], slow_ramp_enabled: false, slow_ramp_max: 2, slow_ramp_increment: 2, send_start_hour: 9, send_end_hour: 18, send_days: ["mon", "tue", "wed", "thu", "fri"], stop_on_reply: true, daily_limit: 100 },
    { id: "leadgen", user_id: CLI, name: "LEAD GENERATION", status: "active", account_tags: ["campaña 1"] },
    { id: "borrador", user_id: CLI, name: "BORRADOR", status: "draft", account_tags: [], send_start_hour: 9, send_end_hour: 18 },
  ];
  const rpcs = {
    ia_client_accounts: (_a: any, t: any) => t.email_accounts.map((a: any) => {
      const directas = (t.campaign_accounts || []).filter((ca: any) => ca.account_id === a.id).map((ca: any) => t.campaigns.find((c: any) => c.id === ca.campaign_id)?.name);
      const porTag = t.campaigns.filter((c: any) => (c.account_tags || []).some((x: string) => (a.tags || []).includes(x))).map((c: any) => c.name);
      const todas = [...new Set([...directas, ...porTag])];
      return { account_id: a.id, email: a.email, status: a.status, tags: a.tags, campanas: todas, campanas_directas: directas, campanas_por_tag: porTag,
        campanas_activas: t.campaigns.filter((c: any) => c.status === "active" && todas.includes(c.name)).length };
    }),
    ia_accounts_set_tags: (a: any, t: any) => {
      for (const acc of t.email_accounts) {
        if (!a.p_ids.includes(acc.id)) continue;
        const base = a.p_replace ? a.p_add : [...(acc.tags || []), ...a.p_add];
        acc.tags = [...new Set(base.map((x: string) => x.trim()))].filter((x: any) => x && !(a.p_remove || []).includes(x)).sort();
      }
      return a.p_ids.length;
    },
    ia_accounts_restore: (a: any, t: any) => {
      for (const s of a.p_snapshot) Object.assign(t.email_accounts.find((x: any) => x.id === s.id), s);
      return a.p_snapshot.length;
    },
  };
  const db = crearDb({ email_accounts: cuentas, campaigns, campaign_accounts: [] }, [], rpcs);
  const ctx: any = { db, cliente: CLIENTE, autor: "hello@onepulso.blog", tarjetas: [] };
  return { db, ctx };
}
const tags = (db: any) => db.t.email_accounts.map((a: any) => a.tags.join("|"));

describe("ideas propias sólo de vez en cuando", () => {
  it("nunca en la primera respuesta; después, una cada 4 como mucho", () => {
    expect(puedeSugerir([])).toBe(false);
    expect(puedeSugerir(["a", "b"])).toBe(false);
    expect(puedeSugerir(["a", "b", "c"])).toBe(true);
    expect(puedeSugerir(["a", `x ${MARCA_IDEA} ¿y si…?`, "b", "c"])).toBe(false);
    expect(puedeSugerir([`${MARCA_IDEA} ¿y si…?`, "b", "c", "d"])).toBe(true);
  });
  it("el prompt le dice en cada turno si puede o no proponer", () => {
    const base = { nombre: "", empresa: "X", email: "x@x.es", notas: "", instruccionesRespuestas: "", skills: "", enlaceReserva: "", campanas: [], hoy: "hoy" };
    expect(sistemaIaMod(base, true)).toMatch(/puedes, si de verdad aporta, añadir UNA idea/);
    expect(sistemaIaMod(base, false)).toMatch(/NO añadas ideas/);
    expect(sistemaIaMod(base, false)).not.toMatch(/\{\{IDEAS\}\}/);
  });
});

describe("seleccionar cuentas para repartir", () => {
  const filas = ["c@x.es", "a@x.es", "b@x.es", "d@x.es"].map((email, i) => ({ account_id: `${i}`, email, tags: ["campaña 1"] }));
  it("mitad y mitad, siempre en el mismo orden", () => {
    expect(seleccionarCuentas(filas, { con_etiqueta: "campaña 1", cantidad: 2 }).map((f) => f.email)).toEqual(["a@x.es", "b@x.es"]);
    expect(seleccionarCuentas(filas, { con_etiqueta: "campaña 1", desde: 2, cantidad: 2 }).map((f) => f.email)).toEqual(["c@x.es", "d@x.es"]);
  });
  it("sin ningún filtro no elige nada (nunca 'todas' por accidente)", () => {
    expect(seleccionarCuentas(filas, {})).toEqual([]);
  });
});

describe("organizar cuentas", () => {
  it("repartir 3 y 3 con etiquetas nuevas: toca campañas activas → Confirmar, luego se aplica y se deshace", async () => {
    const { db, ctx } = montar();
    const r1: any = await ejecutar(ctx, "organizar_cuentas", { con_etiqueta: "campaña 1", cantidad: 3, poner_etiquetas: ["LEADGEN"], solo_estas: true });
    expect(r1.pendiente).toBe(true);
    expect(tags(db)).toEqual(Array(6).fill("campaña 1"));           // aún no ha cambiado nada
    const ch = db.t.ia_mod_changes[0];
    await aplicarPendiente(db, ch);
    expect(tags(db)).toEqual(["LEADGEN", "LEADGEN", "LEADGEN", "campaña 1", "campaña 1", "campaña 1"]);
    expect(ctx.tarjetas[0].lineas[0]).toMatch(/3 cuentas: buzon0@seo.es/);
    const nota = await deshacer(db, db.t.ia_mod_changes[0], CLI);
    expect(nota).toMatch(/Restauradas 3/);
    expect(tags(db)).toEqual(Array(6).fill("campaña 1"));
  });

  it("si no afecta a ninguna campaña activa se aplica ya", async () => {
    const { db, ctx } = montar();
    db.t.campaigns.forEach((c: any) => { c.status = "draft"; });
    const r: any = await ejecutar(ctx, "organizar_cuentas", { emails: ["buzon5@seo.es"], poner_etiquetas: ["PRUEBA"] });
    expect(r.hecho).toBe(true);
    expect(db.t.email_accounts[5].tags).toEqual(["PRUEBA", "campaña 1"]);
  });

  it("una etiqueta que no existe → no toca nada y enseña las que hay", async () => {
    const { ctx } = montar();
    const r: any = await ejecutar(ctx, "organizar_cuentas", { con_etiqueta: "no existe", poner_etiquetas: ["X"] });
    expect(r.error).toMatch(/Ninguna cuenta/);
    expect(r.etiquetas_que_existen).toEqual(["campaña 1"]);
  });
});

describe("conectar cuentas a una campaña", () => {
  it("campaña activa: pendiente; al confirmar cambia etiquetas y cuentas a mano; deshacer lo devuelve", async () => {
    const { db, ctx } = montar();
    db.t.campaign_accounts.push({ id: "ca1", campaign_id: "leadgen", account_id: "acc-0" });
    const r: any = await ejecutar(ctx, "conectar_cuentas_campana", { campaign_id: "leadgen", usar_etiquetas: ["LEADGEN"], quitar_todas_a_mano: true });
    expect(r.pendiente).toBe(true);
    expect(r.resumen).toMatch(/"LEAD GENERATION" pasa de 6 a 0 cuentas/);
    expect(r.detalle.join(" ")).toMatch(/Ninguna cuenta tiene todavía "LEADGEN"/);
    await aplicarPendiente(db, db.t.ia_mod_changes[0]);
    expect(db.t.campaigns.find((c: any) => c.id === "leadgen").account_tags).toEqual(["LEADGEN"]);
    expect(db.t.campaign_accounts.filter((c: any) => c.campaign_id === "leadgen")).toHaveLength(0);
    await deshacer(db, db.t.ia_mod_changes[0], CLI);
    expect(db.t.campaigns.find((c: any) => c.id === "leadgen").account_tags).toEqual(["campaña 1"]);
    expect(db.t.campaign_accounts.filter((c: any) => c.campaign_id === "leadgen").map((c: any) => c.account_id)).toEqual(["acc-0"]);
  });
});

describe("slow ramp por etiqueta", () => {
  it("activa el slow ramp sólo en las cuentas de esa etiqueta, con tope 30", async () => {
    const { db, ctx } = montar();
    db.t.email_accounts[5].tags = ["OTRA"];
    db.t.campaigns.forEach((c: any) => { c.status = "draft"; });
    const r: any = await ejecutar(ctx, "slow_ramp_cuentas", { con_etiqueta: "campaña 1", activar: true, inicio: 8, incremento: 3, maximo: 50 });
    expect(r.hecho).toBe(true);
    const a = db.t.email_accounts[0];
    expect(a).toMatchObject({ warmup_enabled: true, warmup_day: 8, warmup_increment: 3, warmup_limit: 30 });
    expect(db.t.email_accounts[5].warmup_enabled).toBe(false);
    await deshacer(db, db.t.ia_mod_changes[0], CLI);
    expect(db.t.email_accounts[0]).toMatchObject({ warmup_enabled: false, warmup_day: null });
  });
});

describe("ajustar una campaña", () => {
  it("borrador: se aplica ya; horario imposible → error sin tocar nada", async () => {
    const { db, ctx } = montar();
    const mal: any = await ejecutar(ctx, "ajustar_campana", { campaign_id: "borrador", hora_inicio: 18, hora_fin: 9 });
    expect(mal.error).toMatch(/posterior/);
    const r: any = await ejecutar(ctx, "ajustar_campana", { campaign_id: "borrador", slow_ramp: true, slow_ramp_inicio: 5, dias: ["lunes", "martes"] });
    expect(r.hecho).toBe(true);
    const c = db.t.campaigns.find((x: any) => x.id === "borrador");
    expect(c).toMatchObject({ slow_ramp_enabled: true, slow_ramp_max: 5 });
    expect(r.detalle.join(" ")).toMatch(/Slow ramp de campaña: activado/);
  });
  it("activa: pendiente de Confirmar, y nunca cambia el estado de la campaña", async () => {
    const { db, ctx } = montar();
    const r: any = await ejecutar(ctx, "ajustar_campana", { campaign_id: "grande", limite_diario: 300, status: "paused" });
    expect(r.pendiente).toBe(true);
    await aplicarPendiente(db, db.t.ia_mod_changes[0]);
    const c = db.t.campaigns.find((x: any) => x.id === "grande");
    expect(c.daily_limit).toBe(300);
    expect(c.status).toBe("active");
    await deshacer(db, db.t.ia_mod_changes[0], CLI);
    expect(db.t.campaigns.find((x: any) => x.id === "grande").daily_limit).toBe(100);
  });
});
