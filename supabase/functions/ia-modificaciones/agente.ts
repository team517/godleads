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
import { planImportacion, variablesUsadas } from "../_shared/ia-mod.ts";
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

  const system = sistemaIaMod({
    nombre: cliente.nombre, empresa: cliente.empresa, email: cliente.email,
    notas: (nota as any)?.notes || "", instruccionesRespuestas: cliente.instrucciones, skills: cliente.skills,
    enlaceReserva: cliente.enlace,
    campanas: (camps || []).map((c: any) => ({ id: c.id, name: c.name, status: c.status })),
    hoy: new Date().toLocaleDateString("es-ES", { timeZone: "Europe/Madrid", weekday: "long", day: "numeric", month: "long", year: "numeric" }),
  });

  const mensajes: any[] = [{ role: "system", content: system }, ...historial];
  const tarjetas: Tarjeta[] = [];
  const ctx = { db, cliente, autor, tarjetas };

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

interface Ctx { db: Db; cliente: Cliente; autor: string; tarjetas: Tarjeta[] }

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
async function importarLeads(db: Db, clientId: string, campaignId: string, upload: any, renombrar: Record<string, string>) {
  const plan = planImportacion(upload.rows || [], renombrar);
  const nuevos: string[] = [];
  const actualizados: { id: string; antes: Record<string, string> | null }[] = [];
  let saltados = 0;
  for (let i = 0; i < plan.filas.length; i += 500) {
    const lote = plan.filas.slice(i, i + 500);
    const ya = await emailsEnCampana(db, campaignId, lote.map((f) => f.email));
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

async function ejecutar(ctx: Ctx, nombre: string, a: Record<string, any>): Promise<unknown> {
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
      return (camps || []).map((c: any) => {
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
        desde, filas_mostradas: up.rows.slice(desde, desde + cuantas),
      };
    }

    case "importar_leads": {
      const up = await adjuntoDelCliente(ctx, a.upload_id);
      if (up.kind !== "leads") throw new Error("Ese archivo no tiene columna de email: no se pueden importar leads");
      const camp = await campanaDelCliente(ctx, a.campaign_id);
      const renombrar = a.renombrar_columnas && typeof a.renombrar_columnas === "object" ? a.renombrar_columnas as Record<string, string> : {};
      const plan = planImportacion(up.rows, renombrar);
      if (!plan.filas.length) throw new Error("El archivo no tiene ningún email válido");
      const ya = await emailsEnCampana(db, camp.id, plan.filas.map((f) => f.email));
      const pasos = await pasosOrdenados(db, camp.id);
      const usadas = variablesUsadas(pasos.flatMap((p) => [p.subject, p.body, ...variantesDePaso(p).flatMap((v) => [v.asunto, v.cuerpo])]));
      const faltan = usadas.filter((v) => !plan.columnas.includes(v.toLowerCase()) && !plan.columnas.includes(v));
      const nuevos = plan.filas.length - ya.size;
      const summary = `Importar ${nuevos} leads nuevos de "${up.filename}" a "${camp.name}"${ya.size ? ` (y actualizar ${ya.size} que ya estaban)` : ""}`;
      const id = await registrar(ctx, {
        kind: "leads_import", campaign_id: camp.id, summary, status: "pending",
        payload: { upload_id: up.id, renombrar },
      });
      tarjetaCambio(ctx, id, summary, true, {
        campaign_name: camp.name, activa: camp.status === "active",
        importacion: {
          archivo: up.filename, nuevos, actualizados: ya.size, invalidos: plan.invalidos, repetidos: plan.duplicados,
          columnas: plan.columnas, variables_sin_columna: faltan, renombradas: renombrar,
          ejemplo: plan.filas.slice(0, 3).map((f) => ({ email: f.email, ...f.custom_fields })),
        },
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
    const r = await importarLeads(db, ch.client_user_id, ch.campaign_id, up, ch.payload?.renombrar || {});
    await db.from("ia_mod_changes").update({
      status: "applied", resolved_at: ahora,
      after: { nuevos: r.nuevos, saltados: r.saltados, invalidos: r.invalidos, repetidos: r.repetidos },
      before: { actualizados: r.actualizados },
    }).eq("id", ch.id);
    return `${r.nuevos.length} leads añadidos${r.actualizados.length ? `, ${r.actualizados.length} actualizados` : ""}${r.saltados ? `, ${r.saltados} saltados por estar bloqueados` : ""}`;
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
