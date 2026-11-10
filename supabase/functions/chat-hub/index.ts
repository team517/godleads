// chat-hub (10-11-2026): lo que el chatbot flotante necesita además del consultor y de PulseBot.
//  · visitor_chat      — visitante SIN sesión (landing): asistente comercial de Funnyleads con la
//                        clave de IA de la plataforma, límites por conversación / visitante / IP y
//                        conversación guardada (service role; el visitante no toca la BD).
//  · visitor_history   — mensajes de una conversación de visitante (sólo si el visitor_id coincide).
//  · create_request    — "Hablar con el equipo": guarda team_requests y manda el aviso a team@.
//  · list_requests / update_request — sólo el equipo (is_staff_caller).
//  · Chat en directo (10-11-2026): team_open / team_send / team_contact / team_poll / team_unread
//    (cliente o visitante) y team_inbox / team_thread / team_reply / team_close / team_reopen (equipo).
// Los usuarios con sesión guardan y leen sus conversaciones directamente por RLS (chat_conversations
// / chat_messages); aquí sólo pasan para las peticiones y la lista del equipo.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendSmtpReply } from "../_shared/smtp.ts";
import {
  clienteMirando, correoDeContacto, correoMensajeChat, correoPeticion, correoRespuestaAlCliente, debeAvisarEquipo,
  NOTIFY_THROTTLE_MS, nombreDeAutor, quiereHablarConElEquipo, TRANSCRIPT_MAX, validarMensajeEquipo, validarPeticion,
  VISITOR_SYSTEM_PROMPT, visitanteDentroDeLimites,
} from "../_shared/chat-hub-rules.ts";

// deno-lint-ignore no-explicit-any
declare const EdgeRuntime: any;
/** Trabajo que sigue después de responder (correo, push): no hace esperar al chat. */
const enSegundoPlano = (p: Promise<unknown>) => {
  const seguro = p.catch((e) => console.error("chat-hub (segundo plano):", (e as Error).message));
  try { EdgeRuntime.waitUntil(seguro); } catch { /* fuera del runtime de Supabase */ }
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const TEAM_EMAIL = "team@onepulso.online";
const FROM_EMAIL = "support@onepulso.online";
const APP_URL = "https://backend-onepulso-platfomr.25kofp.easypanel.host";
const VISITOR_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Db = ReturnType<typeof createClient>;

/** Quién llama, si trae sesión. */
async function usuarioDe(db: Db, req: Request): Promise<{ id: string; email: string } | null> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  // El cliente manda la clave pública cuando no hay sesión: no es un usuario.
  if (!token || token.split(".").length !== 3) return null;
  try {
    const { data } = await db.auth.getUser(token);
    if (!data?.user) return null;
    return { id: data.user.id, email: String(data.user.email || "").toLowerCase() };
  } catch { return null; }
}

/** ¿Es del equipo? Misma regla que la base (is_staff_caller), evaluada como ese usuario. */
async function esEquipo(req: Request): Promise<boolean> {
  const auth = req.headers.get("Authorization") || "";
  if (!auth) return false;
  const asUser = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } }, auth: { persistSession: false },
  });
  const { data, error } = await asUser.rpc("is_staff_caller");
  return !error && data === true;
}

const ipDe = (req: Request) => (req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip") || "").split(",")[0].trim() || "desconocida";

async function conversacionDeVisitante(db: Db, visitorId: string, conversationId: string | null) {
  if (conversationId) {
    const { data } = await db.from("chat_conversations").select("id, visitor_id, message_count").eq("id", conversationId).maybeSingle();
    if (data && data.visitor_id === visitorId && !("user_id" in data && (data as any).user_id)) return data as { id: string; message_count: number };
    return null;
  }
  const { data, error } = await db.from("chat_conversations").insert({ visitor_id: visitorId, mode: "visitante" }).select("id, message_count").single();
  if (error) throw new Error(error.message);
  return data as { id: string; message_count: number };
}

async function responderVisitante(messages: { role: string; content: string }[]): Promise<string> {
  const apiKey = Deno.env.get("DEEPSEEK_API_KEY") || "";
  if (!apiKey) throw new Error("La IA de la plataforma no está configurada");
  const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "deepseek-chat", temperature: 0.4, max_tokens: 500,
      messages: [{ role: "system", content: VISITOR_SYSTEM_PROMPT }, ...messages],
    }),
  });
  if (!res.ok) throw new Error(`IA no disponible (${res.status})`);
  const j = await res.json();
  return String(j?.choices?.[0]?.message?.content || "").trim() || "Ahora mismo no puedo responder. Si quieres, deja tu correo con «Hablar con el equipo».";
}

/** Manda un correo desde support@ (patrón de monthly-reminders). Por defecto, a team@. */
async function avisarEquipo(db: Db, subject: string, html: string, to = TEAM_EMAIL, fromName = "Funnyleads · Chat"): Promise<{ ok: boolean; error?: string }> {
  const { data: acc } = await db.from("email_accounts")
    .select("email, smtp_host, smtp_port, smtp_username, smtp_password")
    .eq("email", FROM_EMAIL).eq("status", "connected").not("smtp_host", "is", null)
    .limit(1).maybeSingle();
  if (!acc) return { ok: false, error: "buzón support@ no conectado" };
  return await sendSmtpReply(acc.smtp_host, acc.smtp_port || 465, acc.smtp_username || acc.email, acc.smtp_password,
    acc.email, to, subject, html, null, null, fromName);
}

/* ── Chat en directo con el equipo ─────────────────────────────────────────────────────────── */

type Conv = {
  id: string; user_id: string | null; visitor_id: string | null; title: string | null; team_status: string;
  contact_email: string | null; contact_name: string | null; last_notified_at: string | null;
  client_seen_at: string | null; page_url: string | null;
};
const CONV_COLS = "id, user_id, visitor_id, title, team_status, contact_email, contact_name, last_notified_at, client_seen_at, page_url";
const MSG_COLS = "id, role, content, via, author_name, created_at";
const HELLO_EMAIL = "hello@onepulso.blog";

/** La conversación, sólo si es de quien llama: su usuario, o su visitor_id si no tiene usuario. */
async function convPropia(db: Db, convId: unknown, user: { id: string } | null, visitorId: string | null): Promise<Conv | null> {
  if (typeof convId !== "string" || !UUID_RE.test(convId)) return null;
  const { data } = await db.from("chat_conversations").select(CONV_COLS).eq("id", convId).maybeSingle();
  const c = data as Conv | null;
  if (!c) return null;
  if (user && c.user_id === user.id) return c;
  if (!c.user_id && visitorId && c.visitor_id === visitorId) return c;
  return null;
}

async function perfilDe(db: Db, userId: string): Promise<{ full_name: string | null; company_name: string | null }> {
  const { data } = await db.from("profiles").select("full_name, company_name").eq("user_id", userId).maybeSingle();
  return { full_name: (data as any)?.full_name ?? null, company_name: (data as any)?.company_name ?? null };
}

/** Aviso a team@ (y push a hello@) por un mensaje del cliente: el primero de un hilo y, después,
 *  como mucho cada 10 minutos. La marca se "reclama" en la base para que dos mensajes seguidos no
 *  manden dos correos. */
async function avisarMensajeAlEquipo(db: Db, conv: Conv, mensaje: string, user: { id: string; email: string } | null, primero: boolean) {
  const nowMs = Date.now();
  if (!debeAvisarEquipo(conv.last_notified_at, nowMs)) return;
  const umbral = new Date(nowMs - NOTIFY_THROTTLE_MS).toISOString();
  const { data: reclamada } = await db.from("chat_conversations")
    .update({ last_notified_at: new Date(nowMs).toISOString() })
    .eq("id", conv.id).or(`last_notified_at.is.null,last_notified_at.lt.${umbral}`).select("id");
  if (!reclamada || reclamada.length === 0) return;

  const perfil = user ? await perfilDe(db, user.id) : null;
  const quien = conv.contact_name || perfil?.full_name || conv.contact_email || user?.email || "Visitante de la landing";
  const cuenta = user
    ? [`cuenta ${user.email}`, perfil?.company_name].filter(Boolean).join(" · ")
    : conv.contact_email ? `visitante (${conv.contact_email})` : "visitante sin cuenta";
  const { data: previos } = await db.from("chat_messages").select("role, content").eq("conversation_id", conv.id)
    .neq("role", "system").order("created_at", { ascending: false }).limit(8);
  const anteriores = (previos || []).reverse().slice(0, -1).map((m: any) => ({ role: m.role, content: String(m.content || "") }));
  const correo = correoMensajeChat({ quien, cuenta, mensaje, pagina: conv.page_url, appUrl: APP_URL, previos: anteriores, primero });
  const envio = await avisarEquipo(db, correo.subject, correo.html);
  if (!envio.ok) console.error("chat en directo: aviso a team@ fallido:", envio.error);

  // Push a los dispositivos de hello@ (misma función que los avisos de interesados).
  try {
    const { data: helloId } = await db.rpc("user_id_by_email", { p_email: HELLO_EMAIL });
    if (helloId) {
      await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-push`, {
        method: "POST",
        headers: { Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`, "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: helloId, title: "Nuevo mensaje en el chat", body: `${quien}: ${mensaje.slice(0, 140)}`, url: "/peticiones" }),
      });
    }
  } catch (e) { console.error("chat en directo: push a hello@ fallido:", (e as Error).message); }
}

/** Correo al cliente con la respuesta del equipo, si dejó correo y no tiene el chat abierto. */
async function avisarRespuestaAlCliente(db: Db, conv: Conv, autor: string, mensaje: string) {
  if (!conv.contact_email || clienteMirando(conv.client_seen_at, Date.now())) return;
  const enlace = conv.user_id ? `${APP_URL}/dashboard` : `${APP_URL}/`;
  const correo = correoRespuestaAlCliente({ autor, mensaje, enlace });
  const envio = await avisarEquipo(db, correo.subject, correo.html, conv.contact_email, "Funnyleads");
  if (!envio.ok) console.error("chat en directo: correo al cliente fallido:", envio.error);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");
    const user = await usuarioDe(db, req);

    // ── Visitante sin cuenta ────────────────────────────────────────────────────────────────
    if (action === "visitor_chat") {
      const visitorId = String(body.visitor_id || "");
      const message = String(body.message || "").trim().slice(0, 2000);
      if (!VISITOR_ID_RE.test(visitorId)) return json({ error: "visitor_id no válido" }, 400);
      if (!message) return json({ error: "Mensaje vacío" }, 400);
      const conversationId = typeof body.conversation_id === "string" && UUID_RE.test(body.conversation_id) ? body.conversation_id : null;
      const conv = await conversacionDeVisitante(db, visitorId, conversationId);
      if (!conv) return json({ error: "Conversación no encontrada" }, 404);

      const { data: previos } = await db.from("chat_messages").select("role, content").eq("conversation_id", conv.id).order("created_at", { ascending: true }).limit(40);
      const delUsuario = (previos || []).filter((m: any) => m.role === "user").length;
      const [{ data: hoyV }, { data: hoyIp }] = await Promise.all([
        db.rpc("chat_visitor_bump", { p_key: `v:${visitorId}` }),
        db.rpc("chat_visitor_bump", { p_key: `ip:${ipDe(req)}` }),
      ]);
      const limite = visitanteDentroDeLimites(delUsuario, Number(hoyV || 0), Number(hoyIp || 0));
      if (!limite.ok) return json({ error: limite.error, limit: true, conversation_id: conv.id }, 429);

      await db.from("chat_messages").insert({ conversation_id: conv.id, role: "user", content: message, via: "visitante" });
      const historial = [...(previos || []).map((m: any) => ({ role: m.role, content: m.content })), { role: "user", content: message }];
      let reply: string;
      try { reply = await responderVisitante(historial); }
      catch (e) { reply = `Ahora mismo no puedo responder (${(e as Error).message}). Si quieres, deja tu correo con «Hablar con el equipo» y te escribimos.`; }
      await db.from("chat_messages").insert({ conversation_id: conv.id, role: "assistant", content: reply, via: "visitante" });
      return json({ conversation_id: conv.id, reply, suggest_team: quiereHablarConElEquipo(message) });
    }

    if (action === "visitor_history") {
      const visitorId = String(body.visitor_id || "");
      if (!VISITOR_ID_RE.test(visitorId)) return json({ error: "visitor_id no válido" }, 400);
      const { data: convs } = await db.from("chat_conversations").select("id, title, last_message_at, message_count").eq("visitor_id", visitorId).is("user_id", null).order("last_message_at", { ascending: false }).limit(20);
      const conversationId = typeof body.conversation_id === "string" && UUID_RE.test(body.conversation_id) ? body.conversation_id : null;
      let messages: unknown[] = [];
      if (conversationId && (convs || []).some((c: any) => c.id === conversationId)) {
        const { data } = await db.from("chat_messages").select("id, role, content, via, created_at").eq("conversation_id", conversationId).order("created_at", { ascending: true }).limit(200);
        messages = data || [];
      }
      return json({ conversations: convs || [], messages });
    }

    // ── Hablar con el equipo ────────────────────────────────────────────────────────────────
    if (action === "create_request") {
      const v = validarPeticion(body);
      if (!v.ok) return json({ error: v.error }, 400);
      const visitorId = typeof body.visitor_id === "string" && VISITOR_ID_RE.test(body.visitor_id) ? body.visitor_id : null;
      const conversationId = typeof body.conversation_id === "string" && UUID_RE.test(body.conversation_id) ? body.conversation_id : null;
      // La transcripción sólo si la conversación es de quien pide (su usuario o su visitor_id).
      let transcript: { role: string; content: string; created_at: string }[] = [];
      if (conversationId) {
        const { data: conv } = await db.from("chat_conversations").select("id, user_id, visitor_id").eq("id", conversationId).maybeSingle();
        const esSuya = !!conv && ((user && (conv as any).user_id === user.id) || (visitorId && (conv as any).visitor_id === visitorId));
        if (esSuya) {
          const { data } = await db.from("chat_messages").select("role, content, created_at").eq("conversation_id", conversationId).order("created_at", { ascending: false }).limit(TRANSCRIPT_MAX);
          transcript = (data || []).reverse().filter((m: any) => m.role !== "system").map((m: any) => ({ role: m.role, content: String(m.content || "").slice(0, 1000), created_at: m.created_at }));
        }
      }
      const source: "visitor" | "user" = user ? "user" : "visitor";
      const { data: fila, error } = await db.from("team_requests").insert({
        conversation_id: conversationId, user_id: user?.id || null, visitor_id: user ? null : visitorId,
        name: v.value.name, email: v.value.email, company: v.value.company, phone: v.value.phone, topic: v.value.topic,
        message: v.value.message, transcript, source,
      }).select("id").single();
      if (error) return json({ error: `No se pudo guardar la petición: ${error.message}` }, 500);

      const correo = correoPeticion(v.value, { source, transcript, userEmail: user?.email || null, appUrl: APP_URL });
      const envio = await avisarEquipo(db, correo.subject, correo.html);
      await db.from("team_requests").update(envio.ok ? { notified_at: new Date().toISOString(), notify_error: null } : { notify_error: envio.error || "error" }).eq("id", fila.id);
      if (!envio.ok) console.error("aviso a team@ fallido:", envio.error);
      if (conversationId) {
        await db.from("chat_messages").insert({ conversation_id: conversationId, role: "system", content: `Petición enviada al equipo (${v.value.email}).`, via: "equipo" }).then(() => {}, () => {});
      }
      return json({ ok: true, id: fila.id, notified: envio.ok });
    }

    // ── Chat en directo: lado del cliente / visitante ───────────────────────────────────────
    const visitorIdBody = typeof body.visitor_id === "string" && VISITOR_ID_RE.test(body.visitor_id) ? body.visitor_id : null;

    if (action === "team_open" || action === "team_send") {
      if (!user && !visitorIdBody) return json({ error: "Falta el identificador del visitante" }, 400);
      const v = validarMensajeEquipo(body.message);
      if (!v.ok) return json({ error: v.error }, 400);
      let conv = await convPropia(db, body.conversation_id, user, visitorIdBody);
      if (body.conversation_id && !conv) return json({ error: "Conversación no encontrada" }, 404);
      if (!user) {
        const [{ data: hoyV }, { data: hoyIp }] = await Promise.all([
          db.rpc("chat_visitor_bump", { p_key: `v:${visitorIdBody}` }),
          db.rpc("chat_visitor_bump", { p_key: `ip:${ipDe(req)}` }),
        ]);
        const limite = visitanteDentroDeLimites(0, Number(hoyV || 0), Number(hoyIp || 0));
        if (!limite.ok) return json({ error: "Has llegado al límite de mensajes de hoy. Te responderemos a lo que ya nos has escrito.", limit: true }, 429);
      }
      if (!conv) {
        const { data, error } = await db.from("chat_conversations")
          .insert({ user_id: user?.id || null, visitor_id: user ? null : visitorIdBody, mode: user ? "chat" : "visitante" })
          .select(CONV_COLS).single();
        if (error) return json({ error: error.message }, 500);
        conv = data as Conv;
      }
      const ahora = new Date().toISOString();
      const primero = conv.team_status !== "open";
      const patch: Record<string, unknown> = { client_seen_at: ahora };
      if (primero) { patch.team_status = "open"; patch.team_opened_at = ahora; }
      if (user && !conv.contact_email) {
        patch.contact_email = user.email;
        const p = await perfilDe(db, user.id);
        if (p.full_name) patch.contact_name = p.full_name;
      }
      if (typeof body.page === "string" && body.page) patch.page_url = String(body.page).slice(0, 300);
      await db.from("chat_conversations").update(patch).eq("id", conv.id);
      conv = { ...conv, ...(patch as Partial<Conv>) };
      if (primero) {
        await db.from("chat_messages").insert({ conversation_id: conv.id, role: "system", content: "Conversación con el equipo abierta", via: "equipo" });
      }
      const { data: fila, error } = await db.from("chat_messages")
        .insert({ conversation_id: conv.id, role: "user", content: v.value, via: "cliente_equipo" }).select(MSG_COLS).single();
      if (error) return json({ error: `No se pudo enviar: ${error.message}` }, 500);
      enSegundoPlano(avisarMensajeAlEquipo(db, conv, v.value, user, primero));
      return json({ conversation_id: conv.id, team_status: "open", message: fila, contact_email: conv.contact_email || null, needs_email: !user && !conv.contact_email });
    }

    if (action === "team_contact") {
      const conv = await convPropia(db, body.conversation_id, user, visitorIdBody);
      if (!conv) return json({ error: "Conversación no encontrada" }, 404);
      const email = correoDeContacto(body.contact_email);
      if (!email) return json({ error: "El correo no tiene un formato válido." }, 400);
      const name = String(body.contact_name || "").trim().slice(0, 120) || null;
      await db.from("chat_conversations").update({ contact_email: email, ...(name ? { contact_name: name } : {}) }).eq("id", conv.id);
      await db.from("chat_messages").insert({ conversation_id: conv.id, role: "system", content: `Te avisaremos en ${email}`, via: "equipo" });
      return json({ ok: true, contact_email: email });
    }

    if (action === "team_poll") {
      const conv = await convPropia(db, body.conversation_id, user, visitorIdBody);
      if (!conv) return json({ error: "Conversación no encontrada" }, 404);
      const since = typeof body.since === "string" && !Number.isNaN(Date.parse(body.since)) ? body.since : null;
      let q = db.from("chat_messages").select(MSG_COLS).eq("conversation_id", conv.id).order("created_at", { ascending: true }).limit(300);
      if (since) q = q.gt("created_at", since).in("via", ["equipo", "cliente_equipo"]);
      const { data: msgs, error } = await q;
      if (error) return json({ error: error.message }, 500);
      await db.from("chat_conversations").update({ user_unread: 0, client_seen_at: new Date().toISOString() }).eq("id", conv.id);
      return json({ conversation_id: conv.id, team_status: conv.team_status, contact_email: conv.contact_email, messages: msgs || [] });
    }

    if (action === "team_unread") {
      let q = db.from("chat_conversations").select("id, user_unread, team_status, last_message_at").neq("team_status", "none").order("last_message_at", { ascending: false }).limit(5);
      if (user) q = q.eq("user_id", user.id);
      else if (visitorIdBody) q = q.eq("visitor_id", visitorIdBody).is("user_id", null);
      else return json({ error: "Falta el identificador del visitante" }, 400);
      const { data, error } = await q;
      if (error) return json({ error: error.message }, 500);
      const filas = (data || []) as { id: string; user_unread: number; team_status: string }[];
      return json({ unread: filas.reduce((n, c) => n + (c.user_unread || 0), 0), conversation_id: filas[0]?.id || null, team_status: filas[0]?.team_status || "none" });
    }

    // ── Chat en directo: bandeja del equipo ─────────────────────────────────────────────────
    if (["team_inbox", "team_thread", "team_reply", "team_close", "team_reopen"].includes(action)) {
      if (!user || !(await esEquipo(req))) return json({ error: "Sólo el equipo" }, 403);

      if (action === "team_inbox") {
        let q = db.from("chat_conversations")
          .select("id, user_id, visitor_id, title, team_status, team_unread, user_unread, last_message_at, last_client_message_at, last_team_reply_at, contact_email, contact_name, page_url, team_opened_at")
          .neq("team_status", "none").order("last_message_at", { ascending: false }).limit(200);
        const status = String(body.status || "open");
        if (status === "open" || status === "closed") q = q.eq("team_status", status);
        const { data: convs, error } = await q;
        if (error) return json({ error: error.message }, 500);
        const lista = (convs || []) as any[];
        const ids = lista.map((c) => c.id);
        const userIds = [...new Set(lista.map((c) => c.user_id).filter(Boolean))] as string[];
        const [{ data: ultimos }, { data: perfiles }, { data: planes }, emails] = await Promise.all([
          ids.length ? db.from("chat_messages").select("conversation_id, role, content, via, created_at").in("conversation_id", ids).neq("role", "system").order("created_at", { ascending: false }).limit(2000) : Promise.resolve({ data: [] as any[] }),
          userIds.length ? db.from("profiles").select("user_id, full_name, company_name").in("user_id", userIds) : Promise.resolve({ data: [] as any[] }),
          userIds.length ? db.from("user_entitlements").select("user_id, tier, status").in("user_id", userIds) : Promise.resolve({ data: [] as any[] }),
          Promise.all(userIds.map(async (id) => { try { const { data } = await db.auth.admin.getUserById(id); return [id, data?.user?.email || null] as const; } catch { return [id, null] as const; } })),
        ]);
        const ultimo = new Map<string, any>();
        for (const m of (ultimos || []) as any[]) if (!ultimo.has(m.conversation_id)) ultimo.set(m.conversation_id, m);
        const perfil = new Map(((perfiles || []) as any[]).map((p) => [p.user_id, p]));
        const plan = new Map(((planes || []) as any[]).map((p) => [p.user_id, p]));
        const email = new Map(emails);
        const conversations = lista.map((c) => ({
          ...c,
          account_email: c.user_id ? email.get(c.user_id) || null : null,
          full_name: c.user_id ? perfil.get(c.user_id)?.full_name || null : null,
          company: c.user_id ? perfil.get(c.user_id)?.company_name || null : null,
          plan: c.user_id ? plan.get(c.user_id) || null : null,
          last_message: ultimo.get(c.id) || null,
        }));
        const { data: abiertas } = await db.from("chat_conversations").select("team_unread").eq("team_status", "open").gt("team_unread", 0);
        return json({ conversations, unread_total: ((abiertas || []) as any[]).reduce((n, c) => n + (c.team_unread || 0), 0) });
      }

      const convId = String(body.conversation_id || "");
      if (!UUID_RE.test(convId)) return json({ error: "Conversación no válida" }, 400);
      const { data: convRow } = await db.from("chat_conversations").select(CONV_COLS).eq("id", convId).maybeSingle();
      const conv = convRow as Conv | null;
      if (!conv) return json({ error: "Conversación no encontrada" }, 404);

      if (action === "team_thread") {
        const { data: msgs, error } = await db.from("chat_messages").select(MSG_COLS + ", author_email").eq("conversation_id", conv.id).order("created_at", { ascending: true }).limit(500);
        if (error) return json({ error: error.message }, 500);
        await db.from("chat_conversations").update({ team_unread: 0 }).eq("id", conv.id);
        return json({ conversation: conv, messages: msgs || [] });
      }

      if (action === "team_reply") {
        const v = validarMensajeEquipo(body.message);
        if (!v.ok) return json({ error: v.error }, 400);
        const autor = nombreDeAutor(user.email, (await perfilDe(db, user.id)).full_name);
        const { data: fila, error } = await db.from("chat_messages")
          .insert({ conversation_id: conv.id, role: "assistant", content: v.value, via: "equipo", author_email: user.email, author_name: autor })
          .select(MSG_COLS + ", author_email").single();
        if (error) return json({ error: `No se pudo enviar: ${error.message}` }, 500);
        await db.from("chat_conversations").update({ team_unread: 0, team_status: "open" }).eq("id", conv.id);
        enSegundoPlano(avisarRespuestaAlCliente(db, conv, autor, v.value));
        return json({ message: fila });
      }

      // team_close / team_reopen
      const nuevo = action === "team_close" ? "closed" : "open";
      await db.from("chat_conversations").update({ team_status: nuevo, ...(nuevo === "closed" ? { team_unread: 0 } : {}) }).eq("id", conv.id);
      await db.from("chat_messages").insert({ conversation_id: conv.id, role: "system", content: nuevo === "closed" ? "El equipo ha cerrado la conversación" : "Conversación reabierta", via: "equipo" });
      return json({ ok: true, team_status: nuevo });
    }

    // ── Equipo ──────────────────────────────────────────────────────────────────────────────
    if (action === "list_requests" || action === "update_request") {
      if (!user || !(await esEquipo(req))) return json({ error: "Sólo el equipo" }, 403);
      if (action === "list_requests") {
        let q = db.from("team_requests").select("*").order("created_at", { ascending: false }).limit(300);
        const status = String(body.status || "");
        if (["new", "contacted", "closed"].includes(status)) q = q.eq("status", status);
        const { data, error } = await q;
        if (error) return json({ error: error.message }, 500);
        return json({ requests: data || [] });
      }
      const id = String(body.id || "");
      const status = String(body.status || "");
      if (!UUID_RE.test(id) || !["new", "contacted", "closed"].includes(status)) return json({ error: "Datos no válidos" }, 400);
      const { error } = await db.from("team_requests").update({ status, handled_by: user.email, handled_at: new Date().toISOString() }).eq("id", id);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    return json({ error: "Acción no válida" }, 400);
  } catch (e) {
    console.error("chat-hub:", (e as Error).message);
    return json({ error: (e as Error).message || "Error" }, 500);
  }
});
