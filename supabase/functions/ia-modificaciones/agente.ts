// Lógica de "Modificaciones IA" (clientes, conversación con herramientas, confirmar y deshacer).
// Vive aparte de index.ts para poder ejercitarla también desde una prueba controlada.
import {
  ESCRITURAS, IA_MOD_TOOLS, entero, historialParaModelo, leerArgs, paraModelo, sistemaIaMod,
  slotDeLetra, variantesDePaso,
} from "../_shared/ia-mod.ts";
import { cuerpoATexto } from "../_shared/sequence-copy.ts";
import { addVariantTo, readState, removeSlot, versionsOf, writeSlot } from "../_shared/step-variants.ts";
import { fetchWebsiteText } from "../_shared/web-text.ts";
import { replyTextForClassification } from "../_shared/reply-text.ts";
import { origenPlantilla, planImportacion, variablesUsadas, explicarFallo, saludCuenta, VEREDICTO_ES, resumenEtiquetas, tieneTag, seleccionarCuentas, limpiarEtiquetas, puedeSugerir, type FilaCuenta } from "../_shared/ia-mod.ts";
import { aiClassifyReply, evidenceSupported, type AiVerdict } from "../_shared/ai-classify.ts";
import { authorText, classifyMessage } from "../_shared/classify.ts";
import { mergeLeadFields, fieldsChanged } from "../_shared/lead-merge.ts";

const MAX_VUELTAS = 8;
const PLAZO_MS = 115_000;

// Sin tipos generados de la base de datos: el cliente se trata como any (igual que el resto de funciones).
export type Db = any;
export type Tarjeta = Record<string, unknown> & { type: string };

/* ── Clientes ──────────────────────────────────────────────────────────────────────────── */

export async function listarClientes(db: Db) {
  const { data: perfiles } = await db.from("profiles")
    .select("user_id, full_name, company_name, allowed_routes, is_client_manager, logo_url, brand_color")
    .not("allowed_routes", "is", null);
  const clientes = (perfiles || []).filter((p: any) => Array.isArray(p.allowed_routes) && p.allowed_routes.length > 0 && !p.is_client_manager);
  const ids = clientes.map((p: any) => p.user_id);
  if (!ids.length) return [];
  const correos = new Map<string, string>();
  for (let page = 1; page <= 20; page++) {
    const { data } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    for (const u of data?.users || []) correos.set(u.id, u.email || "");
    if ((data?.users || []).length < 1000) break;
  }
  const { data: camps } = await db.from("campaigns").select("user_id, status").in("user_id", ids);
  // Última conversación de cada cliente, para "Conversaciones recientes".
  const { data: ultimos } = await db.from("ia_mod_messages").select("client_user_id, content, role, created_at")
    .in("client_user_id", ids).order("created_at", { ascending: false }).limit(1500);
  const ultimo = new Map<string, { at: string; texto: string }>();
  for (const m of ultimos || []) {
    const id = (m as any).client_user_id;
    if (!ultimo.has(id)) ultimo.set(id, { at: (m as any).created_at, texto: String((m as any).content || "").replace(/\s+/g, " ").slice(0, 90) });
  }
  const cuenta = new Map<string, { total: number; activas: number }>();
  for (const c of camps || []) {
    const x = cuenta.get((c as any).user_id) || { total: 0, activas: 0 };
    x.total++; if ((c as any).status === "active") x.activas++;
    cuenta.set((c as any).user_id, x);
  }
  return clientes
    .map((p: any) => ({
      id: p.user_id,
      email: correos.get(p.user_id) || "",
      full_name: p.full_name || "",
      company_name: p.company_name || "",
      logo_url: p.logo_url || null,
      brand_color: p.brand_color || null,
      campaigns: cuenta.get(p.user_id)?.total || 0,
      active: cuenta.get(p.user_id)?.activas || 0,
      last_chat_at: ultimo.get(p.user_id)?.at || null,
      last_chat_preview: ultimo.get(p.user_id)?.texto || "",
    }))
    .sort((a: any, b: any) => (a.company_name || a.full_name || a.email).localeCompare(b.company_name || b.full_name || b.email, "es"));
}

export interface Cliente {
  id: string; email: string; nombre: string; empresa: string;
  instrucciones: string; skills: string; enlace: string;
}

export async function cargarCliente(db: Db, id: string): Promise<Cliente | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data: p } = await db.from("profiles")
    .select("user_id, full_name, company_name, allowed_routes, is_client_manager, ai_reply_prompt, ai_reply_calendar_url, campaign_skills")
    .eq("user_id", id).maybeSingle();
  if (!p || !Array.isArray((p as any).allowed_routes) || !(p as any).allowed_routes.length || (p as any).is_client_manager) return null;
  const { data: u } = await db.auth.admin.getUserById(id);
  return {
    id, email: u?.user?.email || "",
    nombre: (p as any).full_name || "", empresa: (p as any).company_name || "",
    instrucciones: (p as any).ai_reply_prompt || "", skills: (p as any).campaign_skills || "",
    enlace: (p as any).ai_reply_calendar_url || "",
  };
}

/* ── La conversación con herramientas ──────────────────────────────────────────────────── */

export async function conversar(db: Db, apiKey: string, cliente: Cliente, autor: string): Promise<{ texto: string; tarjetas: Tarjeta[] }> {
  const inicio = Date.now();
  const [{ data: filas }, { data: nota }, { data: camps }] = await Promise.all([
    db.from("ia_mod_messages").select("role, content, cards").eq("client_user_id", cliente.id).order("created_at", { ascending: false }).limit(40),
    db.from("ia_mod_notes").select("notes").eq("client_user_id", cliente.id).maybeSingle(),
    db.from("campaigns").select("id, name, status, created_at").eq("user_id", cliente.id).order("created_at", { ascending: false }),
  ]);
  // Lo que se hizo en turnos anteriores va resumido detrás de cada respuesta, para que la IA
  // recuerde qué cambió sin volver a leer todas las herramientas.
  const historial = historialParaModelo((filas || []).reverse().map((f: any) => {
    const tarjetas = Array.isArray(f.cards) ? f.cards : [];
    if (f.role === "assistant" && tarjetas.length) {
      return { role: f.role, content: `${f.content}\n\n(Hecho en ese turno: ${tarjetas.map((t: any) => t.summary || t.titulo || t.type).join("; ")})` };
    }
    const adjuntos = tarjetas.filter((t: any) => t.type === "adjunto");
    if (f.role === "user" && adjuntos.length) {
      const nota = adjuntos.map((t: any) =>
        `(Adjuntó el archivo "${t.nombre}", id ${t.upload_id}: ${t.filas} filas${t.tipo === "leads" ? ` con email válido (${t.descartadas || 0} descartadas al leerlo)` : " (sin columna de email)"}; columnas: ${(t.columnas || []).join(", ")})`,
      ).join("\n");
      return { role: f.role, content: `${f.content}\n\n${nota}` };
    }
    return { role: f.role, content: f.content };
  }));

  // Ideas propias sólo de vez en cuando (ver puedeSugerir).
  // `filas` ya está en orden cronológico (historialParaModelo le dio la vuelta arriba).
  const sugerir = puedeSugerir(((filas || []) as any[]).filter((f) => f.role === "assistant").map((f) => String(f.content || "")));
  const system = sistemaIaMod({
    nombre: cliente.nombre, empresa: cliente.empresa, email: cliente.email,
    notas: (nota as any)?.notes || "", instruccionesRespuestas: cliente.instrucciones, skills: cliente.skills,
    enlaceReserva: cliente.enlace,
    campanas: (camps || []).map((c: any) => ({ id: c.id, name: c.name, status: c.status })),
    hoy: new Date().toLocaleDateString("es-ES", { timeZone: "Europe/Madrid", weekday: "long", day: "numeric", month: "long", year: "numeric" }),
  }, sugerir);

  const mensajes: any[] = [{ role: "system", content: system }, ...historial];
  const tarjetas: Tarjeta[] = [];
  const ctx: Ctx = { db, cliente, autor, tarjetas, apiKey };

  for (let vuelta = 0; vuelta < MAX_VUELTAS; vuelta++) {
    const ultima = vuelta === MAX_VUELTAS - 1 || Date.now() - inicio > PLAZO_MS - 25_000;
    const r = await llamarModelo(apiKey, mensajes, !ultima);
    const msg = r?.choices?.[0]?.message;
    if (!msg) throw new Error("La IA no ha respondido");
    const llamadas = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
    if (!llamadas.length || ultima) {
      return { texto: String(msg.content || "").trim() || "Hecho.", tarjetas };
    }
    mensajes.push({ role: "assistant", content: msg.content || "", tool_calls: llamadas });
    for (const ll of llamadas) {
      let resultado: unknown;
      try {
        resultado = await ejecutar(ctx, String(ll.function?.name || ""), leerArgs(ll.function?.arguments));
      } catch (e) {
        resultado = { error: e instanceof Error ? e.message : String(e) };
      }
      mensajes.push({ role: "tool", tool_call_id: ll.id, content: paraModelo(resultado) });
    }
  }
  return { texto: "He llegado al límite de pasos de este turno. Dime si sigo.", tarjetas };
}

async function llamarModelo(apiKey: string, messages: any[], conHerramientas: boolean) {
  for (let intento = 0; intento < 2; intento++) {
    const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "deepseek-chat",
        temperature: 0.4,
        max_tokens: 4000,
        messages,
        ...(conHerramientas ? { tools: IA_MOD_TOOLS, tool_choice: "auto" } : {}),
      }),
    });
    if (res.ok) return await res.json();
    const t = await res.text();
    console.error("deepseek", res.status, t.slice(0, 300));
    if (res.status === 402) throw new Error("La IA de la plataforma se ha quedado sin crédito");
    if (res.status !== 429 && res.status < 500) throw new Error(`Error de la IA (${res.status})`);
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error("La IA no responde ahora mismo, prueba en un momento");
}

/* ── Herramientas ──────────────────────────────────────────────────────────────────────── */

interface Ctx {
  db: Db; cliente: Cliente; autor: string; tarjetas: Tarjeta[];
  apiKey?: string;
  /** Para las pruebas: sustituye a la IA que lee cada respuesta. */
  clasificar?: (asunto: string | null, texto: string) => Promise<AiVerdict | null>;
}

async function campanaDelCliente(ctx: Ctx, id: unknown) {
  const { data } = await ctx.db.from("campaigns").select("id, name, status, user_id").eq("id", String(id || "")).maybeSingle();
  if (!data || (data as any).user_id !== ctx.cliente.id) throw new Error("Esa campaña no es de este cliente");
  return data as { id: string; name: string; status: string };
}

async function pasosOrdenados(db: Db, campaignId: string) {
  const { data } = await db.from("campaign_steps")
    .select("id, step_order, subject, body, delay_days, variants, variants_off, created_at")
    .eq("campaign_id", campaignId);
  return ((data || []) as any[]).sort((a, b) => (a.step_order - b.step_order) || String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id)));
}

async function pasoDelCliente(ctx: Ctx, stepId: unknown) {
  const { data: st } = await ctx.db.from("campaign_steps").select("*").eq("id", String(stepId || "")).maybeSingle();
  if (!st) throw new Error("Ese mensaje no existe (vuelve a mirar los mensajes con ver_mensajes)");
  const camp = await campanaDelCliente(ctx, (st as any).campaign_id);
  const pasos = await pasosOrdenados(ctx.db, camp.id);
  const posicion = pasos.findIndex((p) => p.id === (st as any).id) + 1;
  return { st: st as any, camp, posicion, total: pasos.length };
}

async function adjuntoDelCliente(ctx: Ctx, id: unknown) {
  const { data } = await ctx.db.from("ia_mod_uploads").select("*").eq("id", String(id || "")).maybeSingle();
  if (!data || (data as any).client_user_id !== ctx.cliente.id) throw new Error("Ese archivo no existe o no es de este cliente");
  return data as { id: string; filename: string; kind: string; headers: string[]; rows: Record<string, unknown>[]; row_count: number; discarded: number };
}

/** De estos emails, cuáles están ya en la campaña (email → lead). */
async function emailsEnCampana(db: Db, campaignId: string, emails: string[]) {
  const out = new Map<string, { id: string; custom_fields: Record<string, string> | null }>();
  for (let i = 0; i < emails.length; i += 200) {
    const { data } = await db.from("campaign_leads")
      .select("lead_id, leads!inner(id, email, custom_fields)")
      .eq("campaign_id", campaignId)
      .in("leads.email", emails.slice(i, i + 200));
    for (const h of (data || []) as any[]) {
      const l = h.leads;
      if (l?.email) out.set(String(l.email).toLowerCase(), { id: l.id, custom_fields: l.custom_fields || null });
    }
  }
  return out;
}

/** Importa (lo llama "Confirmar"): nuevos → leads + campaign_leads; los que ya estaban se fusionan. */
export async function importarLeads(db: Db, clientId: string, campaignId: string, upload: any, renombrar: Record<string, string>, formato: "plantilla" | "todas" = "plantilla") {
  const plan = planImportacion(upload.rows || [], renombrar, formato);
  // Campaña sin leads: no hace falta buscar duplicados en cada lote.
  const { count: yaHay } = await db.from("campaign_leads").select("id", { count: "exact", head: true }).eq("campaign_id", campaignId);
  const nuevos: string[] = [];
  const actualizados: { id: string; antes: Record<string, string> | null }[] = [];
  let saltados = 0;
  for (let i = 0; i < plan.filas.length; i += 500) {
    const lote = plan.filas.slice(i, i + 500);
    const ya = yaHay ? await emailsEnCampana(db, campaignId, lote.map((f) => f.email)) : new Map();
    const insertar: any[] = [];
    for (const f of lote) {
      const hit = ya.get(f.email);
      if (!hit) { insertar.push({ user_id: clientId, email: f.email, custom_fields: f.custom_fields, is_campaign_only: true }); continue; }
      const fusion = mergeLeadFields(hit.custom_fields, f.custom_fields);
      if (fieldsChanged(hit.custom_fields, fusion)) {
        const { error } = await db.from("leads").update({ custom_fields: fusion }).eq("id", hit.id).eq("user_id", clientId);
        if (!error) actualizados.push({ id: hit.id, antes: hit.custom_fields });
      }
    }
    if (insertar.length) {
      // El trigger de la blocklist se salta los bloqueados sin error: vuelven menos filas.
      const { data, error } = await db.from("leads").insert(insertar).select("id");
      if (error) throw new Error(`No se pudieron guardar los leads: ${error.message}`);
      const ids = (data || []).map((d: any) => d.id);
      saltados += insertar.length - ids.length;
      if (ids.length) {
        const { error: e2 } = await db.from("campaign_leads").upsert(
          ids.map((id: string) => ({ campaign_id: campaignId, lead_id: id })),
          { onConflict: "campaign_id,lead_id", ignoreDuplicates: true },
        );
        if (e2) throw new Error(`No se pudieron añadir a la campaña: ${e2.message}`);
        nuevos.push(...ids);
      }
    }
  }
  return { nuevos, actualizados, saltados, invalidos: plan.invalidos, repetidos: plan.duplicados };
}

/** Filas de cuentas del cliente (con sus etiquetas y campañas), como las ve ver_cuentas. */
async function filasCuentas(ctx: Ctx): Promise<FilaCuenta[]> {
  const { data, error } = await ctx.db.rpc("ia_client_accounts", { p_user: ctx.cliente.id });
  if (error) throw new Error("No se pudieron leer las cuentas");
  return (data || []) as FilaCuenta[];
}

async function seleccionDe(ctx: Ctx, a: Record<string, any>) {
  const camp = a.de_campana ? await campanaDelCliente(ctx, a.de_campana) : null;
  return {
    emails: Array.isArray(a.emails) ? a.emails.map(String) : undefined,
    con_etiqueta: a.con_etiqueta ? String(a.con_etiqueta) : undefined,
    de_campana_nombre: camp?.name, sin_etiqueta: !!a.sin_etiqueta, todas: !!a.todas,
    desde: a.desde, cantidad: a.cantidad,
  };
}

/** Campañas activas del cliente y qué etiquetas usan. */
async function campanasActivasConTags(ctx: Ctx) {
  const { data } = await ctx.db.from("campaigns").select("name, status, account_tags").eq("user_id", ctx.cliente.id).eq("status", "active");
  const porTag = new Map<string, string[]>();
  for (const c of (data || []) as any[]) for (const t of c.account_tags || []) porTag.set(t, [...(porTag.get(t) || []), c.name]);
  return { nombres: new Set(((data || []) as any[]).map((c) => c.name)), porTag };
}

const listaCorreos = (fs: { email: string }[]) =>
  `${fs.length} cuenta${fs.length === 1 ? "" : "s"}: ${fs.slice(0, 4).map((f) => f.email).join(", ")}${fs.length > 4 ? ` y ${fs.length - 4} más` : ""}`;

const CAMPOS_RAMPA = "id, tags, warmup_enabled, warmup_increment, warmup_limit, warmup_day, warmup_started_at";

/** Cómo estaban las cuentas antes (para deshacer). */
async function fotoCuentas(db: Db, clientId: string, ids: string[]) {
  const out: any[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await db.from("email_accounts").select(CAMPOS_RAMPA).eq("user_id", clientId).in("id", ids.slice(i, i + 200));
    out.push(...(data || []));
  }
  return out;
}

/** Aplica un cambio de configuración (cuentas o campaña) y devuelve el "antes" para deshacer. */
async function aplicarConfig(db: Db, clientId: string, kind: string, p: any): Promise<unknown> {
  if (kind === "cuentas_tags") {
    const antes = await fotoCuentas(db, clientId, p.ids);
    for (let i = 0; i < p.ids.length; i += 500) {
      const { error } = await db.rpc("ia_accounts_set_tags", { p_user: clientId, p_ids: p.ids.slice(i, i + 500), p_add: p.poner, p_remove: p.quitar, p_replace: !!p.solo });
      if (error) throw new Error(`No se pudieron cambiar las etiquetas: ${error.message}`);
    }
    return antes;
  }
  if (kind === "cuentas_rampa") {
    const antes = await fotoCuentas(db, clientId, p.ids);
    const cambio = p.activar
      ? { warmup_enabled: true, warmup_increment: p.incremento, warmup_limit: p.maximo, warmup_day: p.inicio, warmup_started_at: new Date().toISOString() }
      : { warmup_enabled: false };
    for (let i = 0; i < p.ids.length; i += 200) {
      const { error } = await db.from("email_accounts").update(cambio).eq("user_id", clientId).in("id", p.ids.slice(i, i + 200));
      if (error) throw new Error(`No se pudo cambiar el slow ramp: ${error.message}`);
    }
    return antes;
  }
  if (kind === "campana_cuentas") {
    const { data: c } = await db.from("campaigns").select("account_tags").eq("id", p.campaign_id).single();
    const { data: dir } = await db.from("campaign_accounts").select("account_id").eq("campaign_id", p.campaign_id);
    const antes = { account_tags: (c as any)?.account_tags || [], directas: ((dir || []) as any[]).map((d) => d.account_id) };
    const { error } = await db.from("campaigns").update({ account_tags: p.account_tags }).eq("id", p.campaign_id);
    if (error) throw new Error(`No se pudo cambiar la campaña: ${error.message}`);
    await ponerDirectas(db, p.campaign_id, antes.directas, p.directas);
    return antes;
  }
  if (kind === "campana_ajustes") {
    const campos = Object.keys(p.cambios || {});
    const { data: c } = await db.from("campaigns").select(campos.join(", ")).eq("id", p.campaign_id).single();
    const { error } = await db.from("campaigns").update(p.cambios).eq("id", p.campaign_id);
    if (error) throw new Error(`No se pudo ajustar la campaña: ${error.message}`);
    return Object.fromEntries(campos.map((k) => [k, (c as any)?.[k] ?? null]));
  }
  throw new Error("Cambio desconocido");
}

/** Deja en campaign_accounts exactamente estas cuentas. */
async function ponerDirectas(db: Db, campaignId: string, actuales: string[], nuevas: string[]) {
  const quitar = actuales.filter((id) => !nuevas.includes(id));
  const poner = nuevas.filter((id) => !actuales.includes(id));
  for (let i = 0; i < quitar.length; i += 200) {
    await db.from("campaign_accounts").delete().eq("campaign_id", campaignId).in("account_id", quitar.slice(i, i + 200));
  }
  for (let i = 0; i < poner.length; i += 500) {
    await db.from("campaign_accounts").insert(poner.slice(i, i + 500).map((account_id) => ({ campaign_id: campaignId, account_id })));
  }
}

/** Aplica ya (con Deshacer) o deja pendiente de Confirmar, y pinta la tarjeta. */
async function guardarOAplicar(ctx: Ctx, c: { kind: string; payload: any; summary: string; lineas: string[]; pendiente: boolean; campaign_id?: string; cuentasAntes?: number; cuentasDespues?: number }) {
  if (c.pendiente) {
    const id = await registrar(ctx, { kind: c.kind, campaign_id: c.campaign_id ?? null, summary: c.summary, payload: c.payload, status: "pending" });
    tarjetaCambio(ctx, id, c.summary, true, { lineas: c.lineas, aviso: "Afecta a una campaña activa: pulsa Confirmar para aplicarlo." });
    return { pendiente: true, change_id: id, resumen: c.summary, detalle: c.lineas, mensaje: "Pendiente de que el usuario pulse Confirmar" };
  }
  const antes = await aplicarConfig(ctx.db, ctx.cliente.id, c.kind, c.payload);
  const id = await registrar(ctx, { kind: c.kind, campaign_id: c.campaign_id ?? null, summary: c.summary, payload: c.payload, before: antes, after: c.payload });
  tarjetaCambio(ctx, id, c.summary, false, { lineas: c.lineas });
  return { hecho: true, change_id: id, resumen: c.summary, detalle: c.lineas };
}

async function registrar(ctx: Ctx, c: {
  kind: string; campaign_id?: string | null; step_id?: string | null; summary: string;
  payload?: unknown; before?: unknown; after?: unknown; status?: string;
}) {
  const { data, error } = await ctx.db.from("ia_mod_changes").insert({
    client_user_id: ctx.cliente.id, author_email: ctx.autor, kind: c.kind,
    campaign_id: c.campaign_id ?? null, step_id: c.step_id ?? null, summary: c.summary,
    payload: c.payload ?? {}, before: c.before ?? null, after: c.after ?? null, status: c.status || "applied",
    resolved_at: c.status === "pending" ? null : new Date().toISOString(),
  }).select("id").single();
  if (error) throw new Error(`No se pudo registrar el cambio: ${error.message}`);
  return (data as any).id as string;
}

function tarjetaCambio(ctx: Ctx, change_id: string, summary: string, pendiente: boolean, extra: Record<string, unknown> = {}) {
  ctx.tarjetas.push({ type: pendiente ? "pendiente" : "cambio", change_id, summary, ...extra });
}

const asunto = (v: unknown) => String(v ?? "").trim().slice(0, 300);
const cuerpo = (v: unknown) => cuerpoATexto(String(v ?? "")).slice(0, 12000);

export async function ejecutar(ctx: Ctx, nombre: string, a: Record<string, any>): Promise<unknown> {
  const { db, cliente } = ctx;
  switch (nombre) {
    case "ver_campanas": {
      const [{ data: camps }, { data: met }] = await Promise.all([
        db.from("campaigns").select("id, name, status, created_at, daily_limit, send_start_hour, send_end_hour, timezone, send_days, stop_on_reply").eq("user_id", cliente.id).order("created_at", { ascending: false }),
        db.rpc("ia_client_metrics", { p_user: cliente.id, p_days: 7 }),
      ]);
      const ids = (camps || []).map((c: any) => c.id);
      const { data: st } = ids.length ? await db.from("campaign_steps").select("campaign_id").in("campaign_id", ids) : { data: [] };
      const nPasos = new Map<string, number>();
      for (const s of st || []) nPasos.set((s as any).campaign_id, (nPasos.get((s as any).campaign_id) || 0) + 1);
      const m = new Map((met || []).map((x: any) => [x.campaign_id, x]));
      const lista = (camps || []).map((c: any) => {
        const x: any = m.get(c.id) || {};
        return {
          id: c.id, nombre: c.name, estado: c.status, creada: String(c.created_at).slice(0, 10),
          mensajes: nPasos.get(c.id) || 0, limite_diario: c.daily_limit,
          horario: `${c.send_start_hour ?? "?"}-${c.send_end_hour ?? "?"} (${c.timezone || "Europe/Madrid"})`,
          parar_al_responder: c.stop_on_reply,
          leads: Number(x.leads_total || 0), leads_pendientes: Number(x.leads_pending || 0),
          enviados: Number(x.sent || 0), contactados: Number(x.contacted || 0), respuestas: Number(x.replied || 0),
          interesados: Number(x.interested || 0), rebotes: Number(x.bounced || 0),
          enviados_7d: Number(x.sent_window || 0), respuestas_7d: Number(x.replies_window || 0),
        };
      });
      // Tarjeta visual: las activas primero; el texto de la IA ya no tiene que repetir la tabla.
      const orden: Record<string, number> = { active: 0, paused: 1, draft: 2 };
      ctx.tarjetas.push({
        type: "campanas", summary: `Campañas de ${cliente.empresa || cliente.email}`,
        campanas: [...lista].sort((a, b) => ((orden[a.estado] ?? 3) - (orden[b.estado] ?? 3)) || b.enviados - a.enviados),
      });
      return lista;
    }

    case "ver_mensajes": {
      const camp = await campanaDelCliente(ctx, a.campaign_id);
      const pasos = await pasosOrdenados(db, camp.id);
      const vista = pasos.map((p, i) => ({
        step_id: p.id, posicion: i + 1, espera_dias: p.delay_days ?? 0,
        asunto: p.subject || "", cuerpo: p.body || "", variantes: variantesDePaso(p),
      }));
      ctx.tarjetas.push({ type: "mensajes", campaign_id: camp.id, campaign_name: camp.name, status: camp.status, steps: vista, summary: `Mensajes de ${camp.name}` });
      return { campana: camp.name, estado: camp.status, mensajes: vista };
    }

    case "metricas": {
      const dias = [7, 14, 30].includes(Number(a.dias)) ? Number(a.dias) : 14;
      const camp = a.campaign_id ? await campanaDelCliente(ctx, a.campaign_id) : null;
      const [{ data: met, error: e1 }, { data: serie, error: e2 }] = await Promise.all([
        db.rpc("ia_client_metrics", { p_user: cliente.id, p_days: dias }),
        db.rpc("ia_client_daily", { p_user: cliente.id, p_campaign: camp?.id ?? null, p_days: dias }),
      ]);
      if (e1 || e2) throw new Error("No se pudieron leer las métricas");
      const filas = ((met || []) as any[]).filter((x) => !camp || x.campaign_id === camp.id);
      const sum = (k: string) => filas.reduce((s, x) => s + Number(x[k] || 0), 0);
      const totales = {
        enviados_periodo: sum("sent_window"), respuestas_periodo: sum("replies_window"),
        enviados: sum("sent"), contactados: sum("contacted"), respuestas: sum("replied"),
        interesados: sum("interested"), rebotes: sum("bounced"),
      };
      const tasa = totales.contactados ? Math.round((totales.respuestas / totales.contactados) * 1000) / 10 : 0;
      const tarjeta = {
        type: "metricas",
        titulo: camp ? camp.name : (cliente.empresa || cliente.nombre || cliente.email),
        subtitulo: camp ? (cliente.empresa || cliente.email) : "Todas las campañas",
        dias, totales: { ...totales, tasa_respuesta: tasa },
        serie: (serie || []).map((d: any) => ({ day: d.day, sends: Number(d.sends), replies: Number(d.replies) })),
        campanas: camp ? [] : filas
          .filter((x) => Number(x.sent) > 0 || x.status === "active")
          .map((x) => ({ nombre: x.name, estado: x.status, enviados_periodo: Number(x.sent_window), respuestas_periodo: Number(x.replies_window), contactados: Number(x.contacted), respuestas: Number(x.replied), interesados: Number(x.interested) }))
          .sort((p, q) => q.enviados_periodo - p.enviados_periodo),
        summary: `Métricas ${dias} días de ${camp ? camp.name : "todas las campañas"}`,
      };
      ctx.tarjetas.push(tarjeta);
      return { periodo_dias: dias, ...tarjeta, type: undefined };
    }

    case "ver_respuestas": {
      const limite = entero(a.limite, 10, 1, 20);
      let q = db.from("inbox_messages")
        .select("from_email, from_name, subject, body_text, body_html, labels, received_at, campaign_id")
        .eq("user_id", cliente.id).eq("is_archived", false).eq("is_sent", false).not("campaign_id", "is", null)
        .or("is_warmup.is.null,is_warmup.eq.false")
        .order("received_at", { ascending: false }).limit(limite);
      if (a.campaign_id) q = q.eq("campaign_id", (await campanaDelCliente(ctx, a.campaign_id)).id);
      if (a.categoria) q = q.contains("labels", [String(a.categoria)]);
      const { data } = await q;
      return (data || []).map((m: any) => ({
        de: m.from_name ? `${m.from_name} <${m.from_email}>` : m.from_email,
        asunto: m.subject, fecha: String(m.received_at).slice(0, 16).replace("T", " "),
        categoria: (m.labels || []).filter((l: string) => l !== "IA").join(", "),
        texto: replyTextForClassification(m.body_text, m.body_html).slice(0, 600),
      }));
    }

    case "ver_cuentas": {
      const [{ data, error }, { data: campsTags }] = await Promise.all([
        db.rpc("ia_client_accounts", { p_user: cliente.id }),
        db.from("campaigns").select("id, name, status, account_tags").eq("user_id", cliente.id),
      ]);
      if (error) throw new Error("No se pudieron leer las cuentas");
      const ahora = Date.now();
      const todas = ((data || []) as any[]).map((f) => {
        const salud = saludCuenta(f, ahora);
        const fallo = explicarFallo(f.ultimo_fallo);
        return {
          email: f.email, nombre: f.nombre || "", proveedor: String(f.proveedor || "").replace(/^smtp\./, ""),
          estado: salud.estado, motivo: salud.motivo, status: f.status,
          enviados_24h: Number(f.enviados_24h || 0), fallidos_24h: Number(f.fallidos_24h || 0),
          limite_diario: f.daily_limit ?? null, warmup: !!f.warmup_enabled, warmup_score: f.warmup_score ?? null,
          tags: (f.tags || []) as string[],
          campanas: (f.campanas || []) as string[],
          campanas_directas: (f.campanas_directas || []) as string[],
          campanas_por_tag: (f.campanas_por_tag || []) as string[],
          en_campana_activa: Number(f.campanas_activas || 0) > 0,
          ultimo_fallo: fallo ? `${fallo.texto}` : "", ultimo_envio: f.last_send_at,
        };
      });
      // Etiquetas y avisos se calculan sobre TODAS las cuentas del cliente, filtre lo que filtre.
      const resumen = resumenEtiquetas(todas, (campsTags || []) as any[]);

      let cuentas = todas;
      const filtros: string[] = [];
      if (a.campaign_id) {
        const camp = await campanaDelCliente(ctx, a.campaign_id);
        cuentas = cuentas.filter((c) => c.campanas.includes(camp.name));
        filtros.push(`campaña "${camp.name}"`);
      }
      if (a.tag) {
        cuentas = cuentas.filter((c) => tieneTag(c.tags, String(a.tag)));
        filtros.push(`etiqueta "${String(a.tag).trim()}"`);
      }
      if (a.email) {
        const q = String(a.email).trim().toLowerCase();
        cuentas = cuentas.filter((c) => c.email.toLowerCase().includes(q));
        filtros.push(`"${String(a.email).trim()}"`);
      }
      const orden: Record<string, number> = { problema: 0, aviso: 1, ok: 2 };
      cuentas.sort((x, y) => (orden[x.estado] - orden[y.estado]) || (Number(y.en_campana_activa) - Number(x.en_campana_activa)) || x.email.localeCompare(y.email));
      const totales = {
        total: cuentas.length,
        ok: cuentas.filter((c) => c.estado === "ok").length,
        avisos: cuentas.filter((c) => c.estado === "aviso").length,
        problemas: cuentas.filter((c) => c.estado === "problema").length,
        problemas_en_campana_activa: cuentas.filter((c) => c.estado === "problema" && c.en_campana_activa).length,
        enviados_24h: cuentas.reduce((t, c) => t + c.enviados_24h, 0),
        fallidos_24h: cuentas.reduce((t, c) => t + c.fallidos_24h, 0),
      };
      const visibles = a.solo_problemas ? cuentas.filter((c) => c.estado !== "ok") : cuentas;
      const etiquetasVisibles = a.tag ? resumen.etiquetas.filter((e) => tieneTag([e.tag], String(a.tag))) : resumen.etiquetas;
      ctx.tarjetas.push({
        type: "cuentas", summary: `Cuentas de ${cliente.empresa || cliente.email}${filtros.length ? ` (${filtros.join(", ")})` : ""}`,
        filtro: filtros.join(", "), totales, cuentas: visibles.slice(0, 150),
        etiquetas: etiquetasVisibles.slice(0, 30), avisos_etiquetas: resumen.avisos, sin_etiqueta: resumen.sin_etiqueta,
      });
      const detalle = (c: typeof cuentas[number]) => ({
        email: c.email, proveedor: c.proveedor, estado: c.estado, motivo: c.motivo, etiquetas: c.tags,
        fallidos_24h: c.fallidos_24h, en_campana_activa: c.en_campana_activa,
        campanas_a_mano: c.campanas_directas, campanas_por_etiqueta: c.campanas_por_tag,
        enviados_24h: c.enviados_24h, limite_diario: c.limite_diario,
      });
      return {
        filtro: filtros.join(", ") || "ninguno", totales,
        etiquetas: etiquetasVisibles.slice(0, 40), avisos_etiquetas: resumen.avisos, cuentas_sin_etiqueta: resumen.sin_etiqueta,
        // Si se busca algo concreto (una cuenta, una etiqueta, pocas cuentas), el detalle de todas.
        cuentas: cuentas.length <= 25 ? cuentas.map(detalle) : undefined,
        cuentas_con_problema_o_aviso: cuentas.filter((c) => c.estado !== "ok").slice(0, 40).map(detalle),
        ...(a.tag && !cuentas.length ? { nota: `Ninguna cuenta tiene la etiqueta "${a.tag}". Etiquetas que existen: ${resumen.etiquetas.map((e) => e.tag).join(", ") || "ninguna"}` } : {}),
        ...(a.email && !cuentas.length ? { nota: `No hay ninguna cuenta que contenga "${a.email}".` } : {}),
      };
    }

    case "revisar_respuestas": {
      const dias = entero(a.dias, 7, 1, 60);
      const max = entero(a.max, 120, 1, 200);
      const desde = new Date(Date.now() - dias * 86400000).toISOString();
      let q = db.from("inbox_messages")
        .select("id, from_email, from_name, subject, body_text, body_html, labels, received_at, campaign_id, lead_id")
        .eq("user_id", cliente.id).eq("is_archived", false).eq("is_sent", false)
        .or("is_warmup.is.null,is_warmup.eq.false")
        .gte("received_at", desde)
        .order("received_at", { ascending: false }).limit(600);
      let campNombre = "";
      if (a.campaign_id) { const camp = await campanaDelCliente(ctx, a.campaign_id); q = q.eq("campaign_id", camp.id); campNombre = camp.name; }
      const { data: msgs, error } = await q;
      if (error) throw new Error("No se pudo leer el Unibox");
      // Sólo lo que responde a nuestras campañas (enlazado a campaña o a un lead), y de cada persona
      // su último mensaje: es el que dice dónde está ahora.
      const vistos = new Set<string>();
      const porPersona: any[] = [];
      for (const m of (msgs || []) as any[]) {
        if (!m.campaign_id && !m.lead_id) continue;
        const quien = String(m.from_email || "").toLowerCase();
        if (!quien || vistos.has(quien)) continue;
        vistos.add(quien);
        porPersona.push(m);
      }
      const aLeer = porPersona.slice(0, max);
      const { data: camps } = await db.from("campaigns").select("id, name").eq("user_id", cliente.id);
      const nombreCamp = new Map(((camps || []) as any[]).map((c) => [c.id, c.name]));
      const clasificar = ctx.clasificar || ((asunto: string | null, texto: string) => aiClassifyReply(ctx.apiKey || "", asunto, texto));
      const inicio = Date.now();
      const resultados: any[] = [];
      // De 12 en 12 en paralelo y con tope de tiempo, para no comerse el turno entero.
      for (let i = 0; i < aLeer.length; i += 12) {
        if (Date.now() - inicio > 65_000) break;
        const lote = aLeer.slice(i, i + 12);
        const hechos = await Promise.all(lote.map(async (m) => {
          const texto = authorText(replyTextForClassification(m.body_text, m.body_html)).trim().slice(0, 2500);
          if (texto.replace(/\s+/g, "").length < 2) return null;
          // Las autorrespuestas evidentes (fuera de oficina, vacaciones, rebotes) las resuelven las
          // reglas, gratis y al instante; todo lo que escribe una persona lo lee la IA.
          const v: AiVerdict | null = classifyMessage(m.subject, texto) === "out_of_office"
            ? { category: "out_of_office", confidence: 1, reason: "respuesta automática", evidence: "" }
            : await clasificar(m.subject, texto).catch(() => null);
          const etiqueta = ((m.labels || []) as string[]).filter((l) => l !== "IA" && l !== "Importante")[0] || "";
          const veredicto = v ? VEREDICTO_ES[v.category] || v.category : "Sin leer";
          const citaOk = v ? evidenceSupported(v.evidence, texto) : false;
          return {
            nombre: m.from_name || "", email: m.from_email, empresa: String(m.from_email || "").split("@")[1] || "",
            campana: nombreCamp.get(m.campaign_id) || "", fecha: m.received_at, asunto: m.subject || "",
            veredicto, cita: v && citaOk ? v.evidence : "", motivo: v?.reason || "", confianza: v?.confidence ?? 0,
            etiqueta, discrepa: !!etiqueta && veredicto !== "Sin leer" && etiqueta !== veredicto,
            texto: texto.slice(0, 400),
          };
        }));
        resultados.push(...hechos.filter(Boolean));
      }
      const cuenta = (v: string) => resultados.filter((r) => r.veredicto === v).length;
      const totales = {
        leidas: resultados.length, personas: porPersona.length,
        interesados: cuenta("Interesado"), preguntas: cuenta("Pregunta"), derivados: cuenta("Derivado"),
        no_interesados: cuenta("No interesado"), no_contactar: cuenta("No contactar"),
        fuera_oficina: cuenta("Fuera de oficina"), neutras: cuenta("Neutral"),
        etiqueta_distinta: resultados.filter((r) => r.discrepa).length,
      };
      const prioridad: Record<string, number> = { "Interesado": 0, "Pregunta": 1, "Derivado": 2 };
      const calientes = resultados.filter((r) => r.veredicto in prioridad)
        .sort((x, y) => (prioridad[x.veredicto] - prioridad[y.veredicto]) || String(y.fecha).localeCompare(String(x.fecha)));
      ctx.tarjetas.push({
        type: "respuestas", summary: `Respuestas leídas de ${cliente.empresa || cliente.email} (${dias} días)`,
        dias, campana: campNombre, totales,
        calientes: calientes.map(({ texto, ...r }) => r),
        distintas: resultados.filter((r) => r.discrepa && !(r.veredicto in prioridad)).map(({ texto, ...r }) => r).slice(0, 15),
      });
      return {
        dias, totales, sin_leer_por_tiempo: Math.max(0, aLeer.length - resultados.length),
        calientes: calientes.map((r) => ({ nombre: r.nombre, email: r.email, campana: r.campana, veredicto: r.veredicto, cita: r.cita, etiqueta: r.etiqueta })),
      };
    }

    case "organizar_cuentas":
    case "slow_ramp_cuentas": {
      const filas = await filasCuentas(ctx);
      const sel = await seleccionDe(ctx, a);
      const elegidas = seleccionarCuentas(filas, sel);
      if (!elegidas.length) {
        const tags = [...new Set(filas.flatMap((f) => f.tags || []))];
        return { error: "Ninguna cuenta coincide con esa selección", cuentas_del_cliente: filas.length, etiquetas_que_existen: tags };
      }
      const activas = await campanasActivasConTags(ctx);
      const ids = elegidas.map((f) => f.account_id);
      let payload: any, summary: string, lineas: string[];
      if (nombre === "organizar_cuentas") {
        const poner = limpiarEtiquetas(a.poner_etiquetas), quitar = limpiarEtiquetas(a.quitar_etiquetas);
        const solo = !!a.solo_estas;
        if (!poner.length && !quitar.length) return { error: "Di qué etiquetas poner o quitar" };
        payload = { ids, poner, quitar, solo };
        summary = [poner.length && `Poner ${poner.map((t) => `"${t}"`).join(", ")}`, quitar.length && `quitar ${quitar.map((t) => `"${t}"`).join(", ")}`]
          .filter(Boolean).join(" y ") + ` en ${ids.length} cuenta${ids.length === 1 ? "" : "s"}${solo ? " (sólo con esas etiquetas)" : ""}`;
        const afectadas = new Set<string>(elegidas.flatMap((f) => f.campanas || []).filter((n) => activas.nombres.has(n)));
        for (const t of poner) for (const c of activas.porTag.get(t) || []) afectadas.add(c);
        lineas = [listaCorreos(elegidas), ...(afectadas.size ? [`Campañas activas afectadas: ${[...afectadas].join(", ")}`] : [])];
        const pendiente = afectadas.size > 0;
        return await guardarOAplicar(ctx, { kind: "cuentas_tags", payload, summary, lineas, pendiente });
      }
      const activar = a.activar !== false;
      const inicio = entero(a.inicio, 5, 1, 30), incremento = entero(a.incremento, 2, 1, 10), maximo = entero(a.maximo, 30, 1, 30);
      payload = { ids, activar, inicio: Math.min(inicio, maximo), incremento, maximo };
      summary = activar
        ? `Slow ramp en ${ids.length} cuenta${ids.length === 1 ? "" : "s"}: empieza en ${Math.min(inicio, maximo)}/día, +${incremento} por día de envío, hasta ${maximo}`
        : `Quitar el slow ramp de ${ids.length} cuenta${ids.length === 1 ? "" : "s"}`;
      const enActiva = elegidas.filter((f) => Number(f.campanas_activas || 0) > 0);
      lineas = [listaCorreos(elegidas), ...(enActiva.length ? [`${enActiva.length} de ellas envían en campañas activas: su envío diario cambia desde el próximo envío`] : [])];
      return await guardarOAplicar(ctx, { kind: "cuentas_rampa", payload, summary, lineas, pendiente: enActiva.length > 0 });
    }

    case "conectar_cuentas_campana": {
      const camp = await campanaDelCliente(ctx, a.campaign_id);
      const filas = await filasCuentas(ctx);
      const { data: c } = await db.from("campaigns").select("account_tags").eq("id", camp.id).single();
      const { data: directas } = await db.from("campaign_accounts").select("account_id").eq("campaign_id", camp.id);
      const tagsAntes: string[] = (c as any)?.account_tags || [];
      const directasAntes = new Set<string>(((directas || []) as any[]).map((d) => d.account_id));
      const porCorreo = (lista: unknown) => {
        const qs = (Array.isArray(lista) ? lista : []).map((e) => String(e).trim().toLowerCase()).filter(Boolean);
        return filas.filter((f) => qs.some((q) => f.email.toLowerCase() === q || f.email.toLowerCase().includes(q))).map((f) => f.account_id);
      };
      const tagsDespues = Array.isArray(a.usar_etiquetas) ? limpiarEtiquetas(a.usar_etiquetas) : tagsAntes;
      const directasDespues = new Set(a.quitar_todas_a_mano ? [] : directasAntes);
      for (const id of porCorreo(a.quitar_emails)) directasDespues.delete(id);
      for (const id of porCorreo(a.anadir_emails)) directasDespues.add(id);
      const cuantas = (tags: string[], dir: Set<string>) =>
        filas.filter((f) => dir.has(f.account_id) || (f.status === "connected" && (f.tags || []).some((t) => tags.includes(t)))).length;
      const antes = cuantas(tagsAntes, directasAntes), despues = cuantas(tagsDespues, directasDespues);
      const sinCuentasConTag = tagsDespues.filter((t) => !filas.some((f) => (f.tags || []).includes(t)));
      const summary = `"${camp.name}" pasa de ${antes} a ${despues} cuentas`;
      const lineas = [
        `Etiquetas que usa: ${tagsDespues.length ? tagsDespues.map((t) => `"${t}"`).join(", ") : "ninguna"}${tagsDespues.join("|") !== tagsAntes.join("|") ? ` (antes: ${tagsAntes.length ? tagsAntes.map((t) => `"${t}"`).join(", ") : "ninguna"})` : ""}`,
        `Cuentas añadidas a mano: ${directasDespues.size} (antes ${directasAntes.size})`,
        ...(sinCuentasConTag.length ? [`Ninguna cuenta tiene todavía ${sinCuentasConTag.map((t) => `"${t}"`).join(", ")}`] : []),
      ];
      const payload = { campaign_id: camp.id, account_tags: tagsDespues, directas: [...directasDespues] };
      return await guardarOAplicar(ctx, { kind: "campana_cuentas", payload, summary, lineas, pendiente: camp.status === "active", campaign_id: camp.id, cuentasAntes: antes, cuentasDespues: despues });
    }

    case "ajustar_campana": {
      const camp = await campanaDelCliente(ctx, a.campaign_id);
      const cambios: Record<string, unknown> = {};
      const lineas: string[] = [];
      const DIAS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
      const NOMBRE_DIA: Record<string, string> = { mon: "lun", tue: "mar", wed: "mié", thu: "jue", fri: "vie", sat: "sáb", sun: "dom" };
      if (typeof a.slow_ramp === "boolean") { cambios.slow_ramp_enabled = a.slow_ramp; lineas.push(`Slow ramp de campaña: ${a.slow_ramp ? "activado" : "desactivado"}`); }
      if (a.slow_ramp_inicio !== undefined) { cambios.slow_ramp_max = entero(a.slow_ramp_inicio, 2, 1, 30); lineas.push(`Empieza en ${cambios.slow_ramp_max} al día por cuenta`); }
      if (a.slow_ramp_incremento !== undefined) { cambios.slow_ramp_increment = entero(a.slow_ramp_incremento, 2, 1, 10); lineas.push(`Sube ${cambios.slow_ramp_increment} por día de envío`); }
      if (a.hora_inicio !== undefined) cambios.send_start_hour = entero(a.hora_inicio, 9, 0, 23);
      if (a.hora_fin !== undefined) cambios.send_end_hour = entero(a.hora_fin, 18, 1, 24);
      if (cambios.send_start_hour !== undefined || cambios.send_end_hour !== undefined) {
        const { data: h } = await db.from("campaigns").select("send_start_hour, send_end_hour").eq("id", camp.id).single();
        const ini = (cambios.send_start_hour ?? (h as any)?.send_start_hour ?? 9) as number, fin = (cambios.send_end_hour ?? (h as any)?.send_end_hour ?? 18) as number;
        if (fin <= ini) return { error: "La hora de fin tiene que ser posterior a la de inicio" };
        lineas.push(`Horario: de ${ini}:00 a ${fin}:00`);
      }
      if (Array.isArray(a.dias)) {
        // En inglés (mon…) o en español (lunes, mar, miércoles…).
        const ES: Record<string, string> = { lun: "mon", mar: "tue", mie: "wed", jue: "thu", vie: "fri", sab: "sat", dom: "sun" };
        const pedidos = (a.dias as string[]).map((x) => String(x).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").slice(0, 3)).map((x) => ES[x] || x);
        const dias = DIAS.filter((d) => pedidos.includes(d));
        if (!dias.length) return { error: "Días no válidos (usa mon, tue, wed, thu, fri, sat, sun)" };
        cambios.send_days = dias; lineas.push(`Días: ${dias.map((d) => NOMBRE_DIA[d]).join(", ")}`);
      }
      if (a.limite_diario !== undefined) { cambios.daily_limit = entero(a.limite_diario, 100, 1, 20000); lineas.push(`Límite diario: ${cambios.daily_limit}`); }
      if (typeof a.parar_al_responder === "boolean") { cambios.stop_on_reply = a.parar_al_responder; lineas.push(`Parar al responder: ${a.parar_al_responder ? "sí" : "no"}`); }
      if (!Object.keys(cambios).length) return { error: "No hay ningún ajuste que cambiar" };
      return await guardarOAplicar(ctx, { kind: "campana_ajustes", payload: { campaign_id: camp.id, cambios }, summary: `Ajustes de "${camp.name}"`, lineas, pendiente: camp.status === "active", campaign_id: camp.id });
    }

    case "leer_web": {
      const texto = await fetchWebsiteText(String(a.url || ""));
      return texto ? { texto } : { error: "No se ha podido leer esa web" };
    }

    case "guardar_nota": {
      const nota = String(a.nota || "").trim().slice(0, 600);
      if (!nota) return { error: "Nota vacía" };
      const { data: prev } = await db.from("ia_mod_notes").select("notes").eq("client_user_id", cliente.id).maybeSingle();
      const fecha = new Date().toLocaleDateString("es-ES", { timeZone: "Europe/Madrid" });
      const notes = `${String((prev as any)?.notes || "").trim()}\n- ${nota} (${fecha})`.trim().slice(-8000);
      await db.from("ia_mod_notes").upsert({ client_user_id: cliente.id, notes, updated_by: ctx.autor, updated_at: new Date().toISOString() }, { onConflict: "client_user_id" });
      ctx.tarjetas.push({ type: "nota", texto: nota, summary: `Nota guardada: ${nota}` });
      return { ok: true };
    }

    case "crear_mensaje": {
      const camp = await campanaDelCliente(ctx, a.campaign_id);
      const pasos = await pasosOrdenados(db, camp.id);
      const n = pasos.length;
      const pos = a.posicion ? entero(a.posicion, n + 1, 1, n + 1) : n + 1;
      const datos = {
        subject: asunto(a.asunto),
        body: cuerpo(a.cuerpo),
        // Sin espera indicada: la que ya usa la campaña en sus follow-ups (el equipo la eligió).
        delay_days: entero(a.espera_dias, pos === 1 ? 0 : (pasos.length > 1 ? Number(pasos[pasos.length - 1].delay_days) || 2 : 2), 0, 60),
      };
      if (!datos.body) throw new Error("El mensaje no tiene cuerpo");
      if (pos <= n) {
        const { count } = await db.from("campaign_leads").select("id", { count: "exact", head: true }).eq("campaign_id", camp.id).lte("current_step", pos - 1).in("status", ["pending", "in_progress"]);
        const summary = `Meter un mensaje nuevo en la posición ${pos} de "${camp.name}"`;
        const id = await registrar(ctx, { kind: "step_insert", campaign_id: camp.id, summary, payload: { pos, ...datos }, status: "pending" });
        tarjetaCambio(ctx, id, summary, true, { campaign_name: camp.name, posicion: pos, asunto: datos.subject, cuerpo: datos.body, espera_dias: datos.delay_days, aviso: count ? `${count} leads en curso lo recibirán cuando les toque` : "" });
        return { pendiente: true, change_id: id, mensaje: "Pendiente de que el usuario pulse Confirmar" };
      }
      const { data: nuevo, error } = await db.rpc("ia_step_insert", { p_campaign: camp.id, p_pos: pos, p_subject: datos.subject, p_body: datos.body, p_delay: datos.delay_days, p_variants: [] });
      if (error) throw new Error(error.message);
      const summary = `Mensaje ${pos} añadido a "${camp.name}"`;
      const id = await registrar(ctx, { kind: "step_insert", campaign_id: camp.id, step_id: nuevo as string, summary, payload: { pos, ...datos }, after: { id: nuevo } });
      tarjetaCambio(ctx, id, summary, false, { campaign_name: camp.name, posicion: pos, asunto: datos.subject, cuerpo: datos.body, espera_dias: datos.delay_days, activa: camp.status === "active" });
      return { ok: true, step_id: nuevo, posicion: pos, campana_activa: camp.status === "active" };
    }

    case "editar_mensaje": {
      const { st, camp, posicion } = await pasoDelCliente(ctx, a.step_id);
      const patch: Record<string, unknown> = {};
      if (a.asunto !== undefined) patch.subject = asunto(a.asunto);
      if (a.cuerpo !== undefined) { patch.body = cuerpo(a.cuerpo); if (!patch.body) throw new Error("El cuerpo no puede quedar vacío"); }
      if (a.espera_dias !== undefined) patch.delay_days = entero(a.espera_dias, st.delay_days ?? 0, 0, 60);
      if (!Object.keys(patch).length) return { error: "No hay nada que cambiar" };
      const before = { subject: st.subject, body: st.body, delay_days: st.delay_days };
      const { error } = await db.from("campaign_steps").update(patch).eq("id", st.id);
      if (error) throw new Error(error.message);
      const summary = `Mensaje ${posicion} de "${camp.name}" editado`;
      const id = await registrar(ctx, { kind: "step_update", campaign_id: camp.id, step_id: st.id, summary, before, after: { ...before, ...patch } });
      tarjetaCambio(ctx, id, summary, false, { campaign_name: camp.name, posicion, asunto: (patch.subject ?? st.subject) as string, cuerpo: (patch.body ?? st.body) as string, espera_dias: (patch.delay_days ?? st.delay_days) as number, antes: before, activa: camp.status === "active" });
      return { ok: true, campana_activa: camp.status === "active" };
    }

    case "eliminar_mensaje": {
      const { st, camp, posicion } = await pasoDelCliente(ctx, a.step_id);
      const summary = `Borrar el mensaje ${posicion} de "${camp.name}"`;
      const id = await registrar(ctx, { kind: "step_delete", campaign_id: camp.id, step_id: st.id, summary, status: "pending", before: st });
      tarjetaCambio(ctx, id, summary, true, { campaign_name: camp.name, posicion, asunto: st.subject, cuerpo: st.body });
      return { pendiente: true, change_id: id, mensaje: "Pendiente de que el usuario pulse Confirmar" };
    }

    case "crear_variante": {
      const { st, camp, posicion } = await pasoDelCliente(ctx, a.step_id);
      const estado = readState(st);
      const body = cuerpo(a.cuerpo);
      if (!body) throw new Error("La variante no tiene cuerpo");
      const { state, slot } = addVariantTo(estado, { subject: asunto(a.asunto) || st.subject || "", body });
      const { error } = await db.from("campaign_steps").update({ variants: state.variants, variants_off: state.off }).eq("id", st.id);
      if (error) throw new Error(error.message);
      if (!(await db.from("campaigns").select("ab_test_enabled").eq("id", camp.id).single()).data?.ab_test_enabled) {
        await db.from("campaigns").update({ ab_test_enabled: true }).eq("id", camp.id);
      }
      const letra = String.fromCharCode(65 + slot);
      const summary = `Variante ${letra} añadida al mensaje ${posicion} de "${camp.name}"`;
      const id = await registrar(ctx, { kind: "variant_state", campaign_id: camp.id, step_id: st.id, summary, before: { variants: estado.variants, variants_off: estado.off }, after: { variants: state.variants, variants_off: state.off } });
      tarjetaCambio(ctx, id, summary, false, { campaign_name: camp.name, posicion, letra, asunto: asunto(a.asunto) || st.subject || "", cuerpo: body, activa: camp.status === "active" });
      return { ok: true, letra };
    }

    case "editar_variante": {
      const { st, camp, posicion } = await pasoDelCliente(ctx, a.step_id);
      const slot = slotDeLetra(a.letra);
      const estado = readState(st);
      const v = versionsOf(estado).find((x) => x.slot === slot);
      if (!slot || !v) throw new Error(`Ese mensaje no tiene variante ${String(a.letra || "").toUpperCase()}`);
      const patch: Record<string, string> = {};
      if (a.asunto !== undefined) patch.subject = asunto(a.asunto);
      if (a.cuerpo !== undefined) { patch.body = cuerpo(a.cuerpo); if (!patch.body) throw new Error("El cuerpo no puede quedar vacío"); }
      const next = writeSlot(estado, slot, patch);
      const { error } = await db.from("campaign_steps").update({ variants: next.variants, variants_off: next.off }).eq("id", st.id);
      if (error) throw new Error(error.message);
      const summary = `Variante ${v.label} del mensaje ${posicion} de "${camp.name}" editada`;
      const id = await registrar(ctx, { kind: "variant_state", campaign_id: camp.id, step_id: st.id, summary, before: { variants: estado.variants, variants_off: estado.off }, after: { variants: next.variants, variants_off: next.off } });
      tarjetaCambio(ctx, id, summary, false, { campaign_name: camp.name, posicion, letra: v.label, asunto: patch.subject ?? v.variant?.subject ?? "", cuerpo: patch.body ?? v.variant?.body ?? "", activa: camp.status === "active" });
      return { ok: true };
    }

    case "eliminar_variante": {
      const { st, camp, posicion } = await pasoDelCliente(ctx, a.step_id);
      const slot = slotDeLetra(a.letra);
      const v = versionsOf(readState(st)).find((x) => x.slot === slot);
      if (!slot || !v) throw new Error(`Ese mensaje no tiene variante ${String(a.letra || "").toUpperCase()}`);
      const summary = `Borrar la variante ${v.label} del mensaje ${posicion} de "${camp.name}"`;
      const id = await registrar(ctx, { kind: "variant_delete", campaign_id: camp.id, step_id: st.id, summary, payload: { slot }, status: "pending" });
      tarjetaCambio(ctx, id, summary, true, { campaign_name: camp.name, posicion, letra: v.label, asunto: v.variant?.subject || "", cuerpo: v.variant?.body || "" });
      return { pendiente: true, change_id: id, mensaje: "Pendiente de que el usuario pulse Confirmar" };
    }

    case "ver_archivo": {
      const up = await adjuntoDelCliente(ctx, a.upload_id);
      const desde = entero(a.desde, 0, 0, Math.max(0, up.row_count - 1));
      const cuantas = entero(a.cuantas, 10, 1, 50);
      const plan = up.kind === "leads" ? planImportacion(up.rows) : null;
      let enCampana: number | null = null;
      if (a.campaign_id && plan) {
        const camp = await campanaDelCliente(ctx, a.campaign_id);
        enCampana = (await emailsEnCampana(db, camp.id, plan.filas.map((f) => f.email))).size;
      }
      return {
        archivo: up.filename, tipo: up.kind, filas: up.row_count, columnas: up.headers,
        descartadas_al_leer: up.discarded,
        ...(plan ? { emails_validos: plan.filas.length, emails_invalidos: plan.invalidos, repetidos_en_el_archivo: plan.duplicados } : {}),
        ...(enCampana !== null ? { ya_en_la_campana: enCampana } : {}),
        ...(up.kind === "leads" ? { plantilla_sale_de: Object.fromEntries(Object.entries(origenPlantilla(up.rows)).filter(([, v]) => v)) } : {}),
        desde, filas_mostradas: up.rows.slice(desde, desde + cuantas),
      };
    }

    case "importar_leads": {
      const up = await adjuntoDelCliente(ctx, a.upload_id);
      if (up.kind !== "leads") throw new Error("Ese archivo no tiene columna de email: no se pueden importar leads");
      const camp = await campanaDelCliente(ctx, a.campaign_id);
      const renombrar = a.renombrar_columnas && typeof a.renombrar_columnas === "object" ? a.renombrar_columnas as Record<string, string> : {};
      const formato: "plantilla" | "todas" = String(a.formato || "plantilla").toLowerCase().startsWith("tod") ? "todas" : "plantilla";
      const plan = planImportacion(up.rows, renombrar, formato);
      if (!plan.filas.length) throw new Error("El archivo no tiene ningún email válido");
      const ya = await emailsEnCampana(db, camp.id, plan.filas.map((f) => f.email));
      const pasos = await pasosOrdenados(db, camp.id);
      const usadas = variablesUsadas(pasos.flatMap((p) => [p.subject, p.body, ...variantesDePaso(p).flatMap((v) => [v.asunto, v.cuerpo])]));
      const faltan = usadas.filter((v) => !plan.columnas.includes(v.toLowerCase()) && !plan.columnas.includes(v));
      const nuevos = plan.filas.length - ya.size;
      const importacion = {
        archivo: up.filename, nuevos, actualizados: ya.size, invalidos: plan.invalidos, repetidos: plan.duplicados,
        columnas: plan.columnas, variables_sin_columna: faltan, renombradas: renombrar, formato,
        ejemplo: plan.filas.slice(0, 3).map((f) => ({ email: f.email, ...f.custom_fields })),
      };
      // Borrador o pausada: importar no manda nada, así que se hace ya (y se puede deshacer). Activa:
      // empezarían a recibir correos, así que espera a "Confirmar". Archivos enormes también van por
      // Confirmar para que la importación tenga su propia petición y no se coma el tiempo del turno.
      if (camp.status !== "active" && plan.filas.length <= 12000) {
        const r = await importarLeads(db, cliente.id, camp.id, up, renombrar, formato);
        const summary = `${r.nuevos.length} leads importados a "${camp.name}"${r.actualizados.length ? ` (${r.actualizados.length} actualizados)` : ""}`;
        const id = await registrar(ctx, {
          kind: "leads_import", campaign_id: camp.id, summary, payload: { upload_id: up.id, renombrar, formato },
          after: { nuevos: r.nuevos, saltados: r.saltados, invalidos: r.invalidos, repetidos: r.repetidos },
          before: { actualizados: r.actualizados },
        });
        tarjetaCambio(ctx, id, summary, false, {
          campaign_name: camp.name, importacion: { ...importacion, nuevos: r.nuevos.length, actualizados: r.actualizados.length },
          aviso: r.saltados ? `${r.saltados} no entraron porque están en la lista de bloqueados.` : "",
        });
        return {
          hecho: true, importados: r.nuevos.length, actualizados: r.actualizados.length, bloqueados: r.saltados,
          invalidos: plan.invalidos, repetidos: plan.duplicados, formato,
          variables_de_los_mensajes: usadas, variables_sin_columna_en_el_csv: faltan,
        };
      }
      const summary = `Importar ${nuevos} leads nuevos de "${up.filename}" a "${camp.name}"${ya.size ? ` (y actualizar ${ya.size} que ya estaban)` : ""}`;
      const id = await registrar(ctx, {
        kind: "leads_import", campaign_id: camp.id, summary, status: "pending",
        payload: { upload_id: up.id, renombrar, formato },
      });
      tarjetaCambio(ctx, id, summary, true, {
        campaign_name: camp.name, activa: camp.status === "active",
        importacion,
        aviso: camp.status === "active" ? "La campaña está activa: los leads nuevos empezarán a recibir correos en los próximos envíos." : "",
      });
      return {
        pendiente: true, change_id: id, nuevos, ya_estaban: ya.size, invalidos: plan.invalidos, repetidos: plan.duplicados,
        variables_de_los_mensajes: usadas, variables_sin_columna_en_el_csv: faltan,
        mensaje: "Pendiente de que el usuario pulse Confirmar",
      };
    }

    case "crear_campana": {
      const nombre = String(a.nombre || "").trim().slice(0, 200) || "Nueva campaña";
      const lista = (Array.isArray(a.mensajes) ? a.mensajes : []).slice(0, 8)
        .map((m: any, i: number) => ({ subject: asunto(m?.asunto), body: cuerpo(m?.cuerpo), delay_days: entero(m?.espera_dias, i === 0 ? 0 : i === 1 ? 2 : 3, 0, 60) }))
        .filter((m: any) => m.body);
      if (!lista.length) throw new Error("La campaña necesita al menos un mensaje con cuerpo");
      if (!lista[0].subject) throw new Error("El primer mensaje necesita asunto");
      const { data: camp, error } = await db.from("campaigns").insert({ user_id: cliente.id, name: nombre, status: "draft", stop_on_reply: true }).select("id").single();
      if (error || !camp) throw new Error(`No se pudo crear la campaña: ${error?.message}`);
      const { error: e2 } = await db.from("campaign_steps").insert(lista.map((m: any, i: number) => ({ campaign_id: (camp as any).id, step_order: i + 1, subject: m.subject, body: m.body, delay_days: m.delay_days, variants: [] })));
      if (e2) { await db.from("campaigns").delete().eq("id", (camp as any).id); throw new Error(e2.message); }
      const summary = `Campaña "${nombre}" creada en borrador con ${lista.length} mensajes`;
      const id = await registrar(ctx, { kind: "campaign_create", campaign_id: (camp as any).id, summary, after: { id: (camp as any).id } });
      tarjetaCambio(ctx, id, summary, false, { campaign_name: nombre, mensajes: lista.map((m: any, i: number) => ({ posicion: i + 1, asunto: m.subject, cuerpo: m.body, espera_dias: m.delay_days })) });
      return { ok: true, campaign_id: (camp as any).id, nota: "En borrador: el cliente tiene que añadir leads y cuentas y activarla" };
    }
  }
  if (ESCRITURAS.has(nombre)) throw new Error("Herramienta no disponible");
  return { error: `No conozco la herramienta ${nombre}` };
}

/* ── Confirmar, deshacer ───────────────────────────────────────────────────────────────── */

export async function aplicarPendiente(db: Db, ch: any): Promise<string> {
  const ahora = new Date().toISOString();
  if (ch.kind === "step_insert") {
    const p = ch.payload || {};
    const { data: camp } = await db.from("campaigns").select("id").eq("id", ch.campaign_id).maybeSingle();
    if (!camp) throw new Error("La campaña ya no existe");
    const { data: nuevo, error } = await db.rpc("ia_step_insert", { p_campaign: ch.campaign_id, p_pos: p.pos, p_subject: p.subject, p_body: p.body, p_delay: p.delay_days, p_variants: [] });
    if (error) throw new Error(error.message);
    await db.from("ia_mod_changes").update({ status: "applied", step_id: nuevo, after: { id: nuevo }, resolved_at: ahora }).eq("id", ch.id);
    return ch.summary;
  }
  if (ch.kind === "step_delete") {
    const { data: fila, error } = await db.rpc("ia_step_delete", { p_step: ch.step_id });
    if (error) throw new Error(error.message);
    if (!fila) throw new Error("Ese mensaje ya no existe");
    await db.from("ia_mod_changes").update({ status: "applied", before: fila, resolved_at: ahora }).eq("id", ch.id);
    return ch.summary;
  }
  if (ch.kind === "variant_delete") {
    const { data: st } = await db.from("campaign_steps").select("*").eq("id", ch.step_id).maybeSingle();
    if (!st) throw new Error("Ese mensaje ya no existe");
    const estado = readState(st);
    const next = removeSlot(estado, Number(ch.payload?.slot));
    await db.from("campaign_steps").update({ variants: next.variants, variants_off: next.off }).eq("id", ch.step_id);
    await db.from("ia_mod_changes").update({ status: "applied", before: { variants: estado.variants, variants_off: estado.off }, after: { variants: next.variants, variants_off: next.off }, resolved_at: ahora }).eq("id", ch.id);
    return ch.summary;
  }
  if (ch.kind === "leads_import") {
    const { data: up } = await db.from("ia_mod_uploads").select("*").eq("id", ch.payload?.upload_id).maybeSingle();
    if (!up || (up as any).client_user_id !== ch.client_user_id) throw new Error("El archivo ya no existe");
    const { data: camp } = await db.from("campaigns").select("id, user_id").eq("id", ch.campaign_id).maybeSingle();
    if (!camp || (camp as any).user_id !== ch.client_user_id) throw new Error("La campaña ya no existe");
    const r = await importarLeads(db, ch.client_user_id, ch.campaign_id, up, ch.payload?.renombrar || {}, ch.payload?.formato === "todas" ? "todas" : "plantilla");
    await db.from("ia_mod_changes").update({
      status: "applied", resolved_at: ahora,
      after: { nuevos: r.nuevos, saltados: r.saltados, invalidos: r.invalidos, repetidos: r.repetidos },
      before: { actualizados: r.actualizados },
    }).eq("id", ch.id);
    return `${r.nuevos.length} leads añadidos${r.actualizados.length ? `, ${r.actualizados.length} actualizados` : ""}${r.saltados ? `, ${r.saltados} saltados por estar bloqueados` : ""}`;
  }
  if (["cuentas_tags", "cuentas_rampa", "campana_cuentas", "campana_ajustes"].includes(ch.kind)) {
    const antes = await aplicarConfig(db, ch.client_user_id, ch.kind, ch.payload || {});
    await db.from("ia_mod_changes").update({ status: "applied", before: antes, after: ch.payload, resolved_at: ahora }).eq("id", ch.id);
    return ch.summary;
  }
  throw new Error("Este cambio no se puede confirmar");
}

export async function deshacer(db: Db, ch: any, clientId: string): Promise<string | void> {
  switch (ch.kind) {
    case "step_insert": {
      const { error } = await db.rpc("ia_step_delete", { p_step: ch.after?.id || ch.step_id });
      if (error) throw new Error(error.message);
      return;
    }
    case "step_update": {
      const { error } = await db.from("campaign_steps").update(ch.before).eq("id", ch.step_id);
      if (error) throw new Error(error.message);
      return;
    }
    case "variant_state":
    case "variant_delete": {
      const { error } = await db.from("campaign_steps").update(ch.before).eq("id", ch.step_id);
      if (error) throw new Error(error.message);
      return;
    }
    case "step_delete": {
      const b = ch.before || {};
      const { data: nuevo, error } = await db.rpc("ia_step_insert", {
        p_campaign: b.campaign_id, p_pos: Number(b.posicion) || null, p_subject: b.subject, p_body: b.body, p_delay: b.delay_days, p_variants: b.variants || [],
      });
      if (error) throw new Error(error.message);
      await db.from("campaign_steps").update({ variants_off: b.variants_off ?? null, attachments: b.attachments ?? null }).eq("id", nuevo);
      return;
    }
    case "leads_import": {
      const nuevos: string[] = Array.isArray(ch.after?.nuevos) ? ch.after.nuevos : [];
      let quitados = 0;
      for (let i = 0; i < nuevos.length; i += 300) {
        const lote = nuevos.slice(i, i + 300);
        const { data: sinEnviar } = await db.from("campaign_leads").select("lead_id")
          .eq("campaign_id", ch.campaign_id).in("lead_id", lote).eq("current_step", 0).in("status", ["pending"]);
        const ids = (sinEnviar || []).map((x: any) => x.lead_id);
        if (!ids.length) continue;
        await db.from("campaign_leads").delete().eq("campaign_id", ch.campaign_id).in("lead_id", ids);
        await db.from("leads").delete().in("id", ids).eq("user_id", clientId).eq("is_campaign_only", true);
        quitados += ids.length;
      }
      for (const u of (Array.isArray(ch.before?.actualizados) ? ch.before.actualizados : [])) {
        await db.from("leads").update({ custom_fields: u.antes || {} }).eq("id", u.id).eq("user_id", clientId);
      }
      return quitados < nuevos.length
        ? `Quitados ${quitados} leads; ${nuevos.length - quitados} ya habían recibido algún correo y se quedan en la campaña`
        : `Quitados los ${quitados} leads importados`;
    }
    case "cuentas_tags":
    case "cuentas_rampa": {
      const foto = Array.isArray(ch.before) ? ch.before : [];
      for (let i = 0; i < foto.length; i += 300) {
        const { error } = await db.rpc("ia_accounts_restore", { p_user: clientId, p_snapshot: foto.slice(i, i + 300) });
        if (error) throw new Error(error.message);
      }
      return `Restauradas ${foto.length} cuentas como estaban`;
    }
    case "campana_cuentas": {
      const b = ch.before || {};
      await db.from("campaigns").update({ account_tags: b.account_tags || [] }).eq("id", ch.campaign_id);
      const { data: dir } = await db.from("campaign_accounts").select("account_id").eq("campaign_id", ch.campaign_id);
      await ponerDirectas(db, ch.campaign_id, ((dir || []) as any[]).map((d) => d.account_id), b.directas || []);
      return;
    }
    case "campana_ajustes": {
      const { error } = await db.from("campaigns").update(ch.before || {}).eq("id", ch.campaign_id);
      if (error) throw new Error(error.message);
      return;
    }
    case "campaign_create": {
      const id = ch.after?.id;
      const { data: camp } = await db.from("campaigns").select("id, user_id, status").eq("id", id).maybeSingle();
      if (!camp) return;
      if ((camp as any).user_id !== clientId) throw new Error("Campaña ajena");
      const [{ count: leads }, { count: envios }] = await Promise.all([
        db.from("campaign_leads").select("id", { count: "exact", head: true }).eq("campaign_id", id),
        db.from("sent_emails").select("id", { count: "exact", head: true }).eq("campaign_id", id),
      ]);
      if ((camp as any).status !== "draft" || (leads || 0) > 0 || (envios || 0) > 0) {
        throw new Error("La campaña ya tiene leads o envíos: no se deshace automáticamente");
      }
      await db.from("campaign_steps").delete().eq("campaign_id", id);
      const { error } = await db.from("campaigns").delete().eq("id", id);
      if (error) throw new Error(error.message);
      return;
    }
  }
  throw new Error("Este cambio no se puede deshacer");
}
