// chat-hub (10-11-2026): lo que el chatbot flotante necesita además del consultor y de PulseBot.
//  · visitor_chat      — visitante SIN sesión (landing): asistente comercial de Funnyleads con la
//                        clave de IA de la plataforma, límites por conversación / visitante / IP y
//                        conversación guardada (service role; el visitante no toca la BD).
//  · visitor_history   — mensajes de una conversación de visitante (sólo si el visitor_id coincide).
//  · create_request    — "Hablar con el equipo": guarda team_requests y manda el aviso a team@.
//  · list_requests / update_request — sólo el equipo (is_staff_caller).
// Los usuarios con sesión guardan y leen sus conversaciones directamente por RLS (chat_conversations
// / chat_messages); aquí sólo pasan para las peticiones y la lista del equipo.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendSmtpReply } from "../_shared/smtp.ts";
import {
  correoPeticion, quiereHablarConElEquipo, TRANSCRIPT_MAX, validarPeticion, VISITOR_SYSTEM_PROMPT, visitanteDentroDeLimites,
} from "../_shared/chat-hub-rules.ts";

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

/** Manda el aviso a team@ desde support@ (patrón de monthly-reminders). */
async function avisarEquipo(db: Db, subject: string, html: string): Promise<{ ok: boolean; error?: string }> {
  const { data: acc } = await db.from("email_accounts")
    .select("email, smtp_host, smtp_port, smtp_username, smtp_password")
    .eq("email", FROM_EMAIL).eq("status", "connected").not("smtp_host", "is", null)
    .limit(1).maybeSingle();
  if (!acc) return { ok: false, error: "buzón support@ no conectado" };
  return await sendSmtpReply(acc.smtp_host, acc.smtp_port || 465, acc.smtp_username || acc.email, acc.smtp_password,
    acc.email, TEAM_EMAIL, subject, html, null, null, "Funnyleads · Chat");
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
