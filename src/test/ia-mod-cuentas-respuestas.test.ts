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
