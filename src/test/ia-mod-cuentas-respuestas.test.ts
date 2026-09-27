// Cuentas de correo y lectura de respuestas de PulseBot, con el código real del servidor.
import { describe, expect, it } from "vitest";
import { ejecutar } from "../../supabase/functions/ia-modificaciones/agente";
import { explicarFallo, saludCuenta } from "../../supabase/functions/_shared/ia-mod";
import { crearDb } from "./helpers/fake-db";

const AHORA = Date.parse("2026-09-27T16:00:00Z");
const hace = (min: number, base = AHORA) => new Date(base - min * 60000).toISOString();

describe("errores de envío en lenguaje llano", () => {
  it("535 de IONOS = problema de la cuenta", () => {
    expect(explicarFallo("Auth failed: 535 Authentication credentials invalid\r\n")?.tipo).toBe("cuenta");
  });
  it("dirección que no existe = culpa del destinatario, no de la cuenta", () => {
    expect(explicarFallo("Recipient rejected: 556-Requested action not taken: domain does not accept mail")?.tipo).toBe("destinatario");
    expect(explicarFallo("550 5.1.1 User unknown")?.tipo).toBe("destinatario");
  });
  it("451 = temporal aunque diga 'recipient rejected'", () => {
    expect(explicarFallo("Recipient rejected: 451-Requested action aborted: local error")?.tipo).toBe("temporal");
  });
  it("cuota del proveedor = la cuenta está frenada", () => {
    expect(explicarFallo("452 4.5.3 Daily user sending quota exceeded")?.tipo).toBe("cuenta");
  });
});

describe("salud de una cuenta", () => {
  const base = { email: "a@x.es", status: "connected", last_error: null, last_sync: hace(2), fallidos_24h: 0, ultimo_fallo: null, ultimo_fallo_at: null };
  it("bien", () => expect(saludCuenta(base, AHORA).estado).toBe("ok"));
  it("535 en las últimas 24 h → problema", () => {
    expect(saludCuenta({ ...base, fallidos_24h: 5, ultimo_fallo: "535 Authentication credentials invalid", ultimo_fallo_at: hace(200) }, AHORA)).toMatchObject({ estado: "problema" });
  });
  it("sólo rebotes de destinatarios → sigue bien", () => {
    expect(saludCuenta({ ...base, fallidos_24h: 3, ultimo_fallo: "550 User unknown", ultimo_fallo_at: hace(30) }, AHORA).estado).toBe("ok");
  });
  it("desconectada o sin sincronizar", () => {
    expect(saludCuenta({ ...base, status: "error" }, AHORA).estado).toBe("problema");
    expect(saludCuenta({ ...base, last_sync: hace(300) }, AHORA).estado).toBe("aviso");
  });
});

const CLIENTE = { id: "cli-1", email: "marketing@oncontrol.es", nombre: "", empresa: "OnControl", instrucciones: "", skills: "", enlace: "" };

describe("ver_cuentas", () => {
  it("pone primero las que fallan en una campaña activa y no da contraseñas", async () => {
    const ahora = new Date().toISOString();
    const filas = [
      { email: "ok@oncontrolone.es", status: "connected", proveedor: "smtp.ionos.es", daily_limit: 30, enviados_24h: 29, fallidos_24h: 0, ultimo_fallo: null, ultimo_fallo_at: null, last_error: null, last_sync: ahora, campanas: ["Campaña oncontrol"], campanas_activas: 1 },
      { email: "alfons@oncontrolstudio.com", status: "connected", proveedor: "smtp.ionos.es", daily_limit: 30, enviados_24h: 0, fallidos_24h: 5, ultimo_fallo: "Auth failed: 535 Authentication credentials invalid", ultimo_fallo_at: ahora, last_error: null, last_sync: ahora, campanas: ["Campaña oncontrol"], campanas_activas: 1 },
    ];
    const db = crearDb({}, [], { ia_client_accounts: filas });
    const ctx: any = { db, cliente: CLIENTE, autor: "hello@onepulso.blog", tarjetas: [] };
    const r: any = await ejecutar(ctx, "ver_cuentas", {});
    expect(r.totales).toMatchObject({ total: 2, ok: 1, problemas: 1, problemas_en_campana_activa: 1, enviados_24h: 29, fallidos_24h: 5 });
    expect(r.cuentas_con_problema_o_aviso[0]).toMatchObject({ email: "alfons@oncontrolstudio.com", estado: "problema", proveedor: "ionos.es" });
    expect(ctx.tarjetas[0].type).toBe("cuentas");
    expect(JSON.stringify(r)).not.toMatch(/password|imap_/i);
  });
});

describe("revisar_respuestas lee cada mensaje", () => {
  const ya = Date.now();
  const msgs = [
    // Etiqueta "Neutral" pero en realidad está interesado → la IA lo detecta y avisa.
    { id: "m1", user_id: "cli-1", from_email: "ana@acme.es", from_name: "Ana", subject: "Re: idea", body_text: "Hola, sí me interesa, ¿podemos hablar el jueves?\n\nEl mar, 23 sept 2026 a las 10:00, Juanjo escribió:\n> Buenas Ana\n> te escribo porque", labels: ["Neutral"], received_at: hace(60, ya), campaign_id: "c1", lead_id: "l1", is_archived: false, is_sent: false, is_warmup: false },
    // Dos mensajes de la misma persona: cuenta el último.
    { id: "m2", user_id: "cli-1", from_email: "luis@beta.es", from_name: "Luis", subject: "Re: idea", body_text: "¿Cuánto cuesta?", labels: ["Pregunta"], received_at: hace(30, ya), campaign_id: "c1", lead_id: "l2", is_archived: false, is_sent: false, is_warmup: false },
    { id: "m3", user_id: "cli-1", from_email: "luis@beta.es", from_name: "Luis", subject: "Re: idea", body_text: "Recibido", labels: [], received_at: hace(90, ya), campaign_id: "c1", lead_id: "l2", is_archived: false, is_sent: false, is_warmup: false },
    // Warm-up y correo suelto (sin campaña ni lead) → fuera.
    { id: "m4", user_id: "cli-1", from_email: "pool@warm.io", subject: "ok", body_text: "thanks", labels: [], received_at: hace(10, ya), campaign_id: "c1", lead_id: null, is_archived: false, is_sent: false, is_warmup: true },
    { id: "m5", user_id: "cli-1", from_email: "news@tienda.es", subject: "Ofertas", body_text: "Compra ya", labels: [], received_at: hace(10, ya), campaign_id: null, lead_id: null, is_archived: false, is_sent: false, is_warmup: false },
    { id: "m6", user_id: "cli-1", from_email: "no@gamma.es", from_name: "Nora", subject: "Re: idea", body_text: "No nos interesa, gracias", labels: ["No interesado"], received_at: hace(45, ya), campaign_id: "c1", lead_id: "l3", is_archived: false, is_sent: false, is_warmup: false },
  ];

  it("clasifica cada respuesta, se queda con el último mensaje de cada persona y avisa si la etiqueta no coincide", async () => {
    const leidos: string[] = [];
    const clasificar = async (_asunto: string | null, texto: string) => {
      leidos.push(texto);
      if (/me interesa/.test(texto)) return { category: "interested" as const, confidence: 0.9, reason: "quiere hablar", evidence: "sí me interesa" };
      if (/Cuánto/.test(texto)) return { category: "question" as const, confidence: 0.9, reason: "precio", evidence: "¿Cuánto cuesta?" };
      return { category: "not_interested" as const, confidence: 0.9, reason: "no", evidence: "No nos interesa" };
    };
    const db = crearDb({ inbox_messages: msgs, campaigns: [{ id: "c1", user_id: "cli-1", name: "Campaña oncontrol", status: "active" }] });
    const ctx: any = { db, cliente: CLIENTE, autor: "hello@onepulso.blog", tarjetas: [], clasificar };
    const r: any = await ejecutar(ctx, "revisar_respuestas", { dias: 7 });
    expect(r.totales).toMatchObject({ leidas: 3, personas: 3, interesados: 1, preguntas: 1, no_interesados: 1, etiqueta_distinta: 1 });
    expect(r.calientes.map((c: any) => c.email)).toEqual(["ana@acme.es", "luis@beta.es"]);
    expect(r.calientes[0]).toMatchObject({ veredicto: "Interesado", etiqueta: "Neutral", cita: "sí me interesa", campana: "Campaña oncontrol" });
    // Lee sólo lo que escribió la persona, sin la cita del correo original.
    expect(leidos.find((t) => /me interesa/.test(t))).not.toMatch(/escribió|te escribo/);
    expect(ctx.tarjetas[0]).toMatchObject({ type: "respuestas" });
  });

  it("una cita que no está en el texto no se enseña (la IA no puede inventarse frases)", async () => {
    const clasificar = async () => ({ category: "interested" as const, confidence: 0.8, reason: "x", evidence: "quiero contratar ya mismo" });
    const db = crearDb({ inbox_messages: [msgs[1]], campaigns: [{ id: "c1", user_id: "cli-1", name: "C", status: "active" }] });
    const ctx: any = { db, cliente: CLIENTE, autor: "x", tarjetas: [], clasificar };
    const r: any = await ejecutar(ctx, "revisar_respuestas", {});
    expect(r.calientes[0].cita).toBe("");
  });
});

import { resumenEtiquetas, tieneTag } from "../../supabase/functions/_shared/ia-mod";

describe("etiquetas (tags) de las cuentas", () => {
  const cuentas = [
    { email: "a@seo.es", tags: ["campaña 1"], estado: "ok" as const },
    { email: "b@seo.es", tags: ["campaña 1"], estado: "problema" as const },
    { email: "c@seo.es", tags: ["campaña 2"], estado: "ok" as const },
    { email: "d@seo.es", tags: ["chipsfinder SPAIN"], estado: "ok" as const },
    { email: "e@seo.es", tags: [], estado: "ok" as const },
  ];
  const campanas = [
    { name: "GRANDE", status: "active", account_tags: ["campaña 1"] },
    { name: "LEAD GENERATION", status: "active", account_tags: ["campaña 1"] },
    { name: "PYMES", status: "active", account_tags: ["campaña 2"] },
    { name: "ESPAÑA", status: "draft", account_tags: ["CHIPSFINDER spain"] },
    { name: "COCO", status: "active", account_tags: ["COCOCREATIVIDAD"] },
  ];
  const r = resumenEtiquetas(cuentas, campanas);

  it("cuántas cuentas lleva cada etiqueta y qué campañas la usan", () => {
    expect(r.etiquetas[0]).toMatchObject({ tag: "campaña 1", cuentas: 2, ok: 1, problemas: 1, campanas: ["GRANDE", "LEAD GENERATION"] });
    expect(r.etiquetas.find((e) => e.tag === "campaña 2")).toMatchObject({ cuentas: 1, campanas: ["PYMES"] });
    expect(r.sin_etiqueta).toBe(1);
  });
  it("avisa de mayúsculas distintas (el motor no las usa)", () => {
    expect(r.avisos.some((a) => /ESPAÑA.*"CHIPSFINDER spain".*"chipsfinder SPAIN".*mayúsculas/.test(a))).toBe(true);
  });
  it("avisa de una etiqueta que ninguna cuenta tiene", () => {
    expect(r.avisos.some((a) => /COCO.*"COCOCREATIVIDAD" y ninguna cuenta la tiene/.test(a))).toBe(true);
  });
  it("avisa de dos campañas activas que comparten los mismos buzones", () => {
    expect(r.avisos.some((a) => /"GRANDE" y "LEAD GENERATION".*"campaña 1".*2 buzones/.test(a))).toBe(true);
  });
  it("buscar una etiqueta no distingue mayúsculas ni espacios", () => {
    expect(tieneTag(["Campaña 1"], "  campaña 1 ")).toBe(true);
    expect(tieneTag(["campaña 1"], "campaña 2")).toBe(false);
  });
});

describe("ver_cuentas con etiquetas", () => {
  const ahora = new Date().toISOString();
  const fila = (email: string, tags: string[], porTag: string[], directas: string[] = []) => ({
    email, status: "connected", proveedor: "smtp.ionos.es", daily_limit: 30, enviados_24h: 10, fallidos_24h: 0, ultimo_fallo: null,
    ultimo_fallo_at: null, last_error: null, last_sync: ahora, tags, campanas: [...porTag, ...directas], campanas_por_tag: porTag, campanas_directas: directas, campanas_activas: porTag.length,
  });
  const filas = [
    fila("juanjo@seoinnova-agency.com", ["campaña 1"], ["GRANDE", "LEAD GENERATION"]),
    fila("juanjo@seoinnova-agency.es", ["campaña 1"], ["GRANDE", "LEAD GENERATION"]),
    fila("juanjo@seoinnova-pymes.com", ["campaña 2"], ["PYMES"], ["PRUEBA"]),
  ];
  const campaigns = [
    { id: "g", user_id: "cli-1", name: "GRANDE", status: "active", account_tags: ["campaña 1"] },
    { id: "l", user_id: "cli-1", name: "LEAD GENERATION", status: "active", account_tags: ["campaña 1"] },
    { id: "p", user_id: "cli-1", name: "PYMES", status: "active", account_tags: ["campaña 2"] },
  ];
  const nuevo = () => {
    const db = crearDb({ campaigns }, [], { ia_client_accounts: filas });
    return { db, cliente: { id: "cli-1", email: "info@seoinnova.es", nombre: "", empresa: "Seo Innova", instrucciones: "", skills: "", enlace: "" }, autor: "x", tarjetas: [] as any[] };
  };

  it("¿qué etiqueta tiene esta cuenta? → exacta, con sus campañas por etiqueta y a mano", async () => {
    const ctx: any = nuevo();
    const r: any = await ejecutar(ctx, "ver_cuentas", { email: "seoinnova-pymes" });
    expect(r.cuentas).toHaveLength(1);
    expect(r.cuentas[0]).toMatchObject({ email: "juanjo@seoinnova-pymes.com", etiquetas: ["campaña 2"], campanas_por_etiqueta: ["PYMES"], campanas_a_mano: ["PRUEBA"] });
  });
  it("¿qué cuentas llevan la etiqueta 'Campaña 1'? → sin distinguir mayúsculas", async () => {
    const ctx: any = nuevo();
    const r: any = await ejecutar(ctx, "ver_cuentas", { tag: "Campaña 1" });
    expect(r.totales.total).toBe(2);
    expect(r.etiquetas).toEqual([{ tag: "campaña 1", cuentas: 2, ok: 2, problemas: 0, campanas: ["GRANDE", "LEAD GENERATION"] }]);
    expect(r.avisos_etiquetas.some((a: string) => /comparten/.test(a))).toBe(true);
    expect(ctx.tarjetas[0]).toMatchObject({ type: "cuentas", filtro: 'etiqueta "Campaña 1"' });
  });
  it("una etiqueta que no existe → lo dice y enseña las que hay", async () => {
    const ctx: any = nuevo();
    const r: any = await ejecutar(ctx, "ver_cuentas", { tag: "campaña 9" });
    expect(r.totales.total).toBe(0);
    expect(r.nota).toMatch(/Ninguna cuenta tiene la etiqueta "campaña 9".*campaña 1, campaña 2/);
  });
});
