// "Modificaciones IA" — el chat del equipo (hello@, support@, equipo@) sobre la cuenta de un
// cliente. La IA (DeepSeek con herramientas) ve sus campañas, mensajes, métricas y respuestas,
// lee su web, guarda memoria del cliente y crea / edita / borra mensajes calcando los EJEMPLOS
// QUE FUNCIONAN. Todo cambio queda en ia_mod_changes con el antes y el después (se puede
// deshacer); borrar o meter un mensaje en medio espera a que el usuario pulse "Confirmar".
//
// Acciones: clients | history | campaigns | upload_start | upload_append | chat | confirm | cancel | undo | clear | save_notes
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { intencionDeConfirmar, mensajeResultado, puedeUsarIaMod } from "../_shared/ia-mod.ts";
import { resolveAiKeyForAuth } from "../_shared/ai-key.ts";
import { aplicarPorTexto, cargarCliente, cargarPropio, confirmarCambio, conversar, deshacer, listarClientes, mantenerMemoria, type ModeloIa } from "./agente.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  try {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "No autorizado" }, 401);
    const { data: ud } = await db.auth.getUser(token);
    const email = (ud?.user?.email || "").toLowerCase();
    if (!ud?.user) return json({ error: "No autorizado" }, 401);

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");

    // MODO PROPIO (self): cualquier usuario sobre SU cuenta, desde el chatbot flotante (03-10-2026,
    // petición del dueño: "que cada persona pueda aplicar cambios en sus mensajes desde el chatbot").
    // Mismas herramientas y mismo Confirmar/Deshacer; la clave de IA es la suya o la de la
    // plataforma según BYOK. Sin self: el chat del equipo sobre la cuenta de un cliente, como siempre.
    const self = body.self === true;
    let ia: ModeloIa | undefined;
    let apiKey = "";
    if (self) {
      const k = await resolveAiKeyForAuth(req.headers.get("Authorization") || "");
      if (k === "unauthorized") return json({ error: "No autorizado" }, 401);
      if (k === "needs_key") return json({ error: "Para usar la IA pon tu clave de OpenAI o DeepSeek en Ajustes → IA" }, 402);
      apiKey = k.apiKey;
      ia = { baseUrl: k.baseUrl, model: k.model };
    } else {
      if (!puedeUsarIaMod(email)) return json({ error: "Sólo el equipo (hello@, support@, equipo@) puede usar Modificaciones IA" }, 403);
      apiKey = Deno.env.get("DEEPSEEK_API_KEY") || "";
    }

    if (action === "clients") {
      if (self) return json({ error: "Acción no disponible" }, 400);
      return json({ clients: await listarClientes(db) });
    }

    // Todo lo demás es sobre UNA cuenta: la propia (self) o la de un cliente de verdad (cuenta
    // creada por la agencia), nunca una cuenta del equipo ni un registro propio.
    const clientId = self ? String(ud.user.id) : String(body.client_id || "");
    const cliente = self ? await cargarPropio(db, clientId, email) : await cargarCliente(db, clientId);
    if (!cliente) return json({ error: "Cliente no válido" }, 400);

    if (action === "history") {
      const [{ data: msgs }, { data: nota }, { data: cambios }] = await Promise.all([
        db.from("ia_mod_messages").select("id, role, content, cards, author_email, created_at").eq("client_user_id", clientId).order("created_at", { ascending: true }).limit(200),
        db.from("ia_mod_notes").select("notes, updated_at, updated_by").eq("client_user_id", clientId).maybeSingle(),
        db.from("ia_mod_changes").select("id, status").eq("client_user_id", clientId).order("created_at", { ascending: false }).limit(300),
      ]);
      return json({
        messages: msgs || [],
        notes: (nota as any)?.notes || "",
        changes: Object.fromEntries((cambios || []).map((c: any) => [c.id, c.status])),
      });
    }

    if (action === "campaigns") {
      const { data } = await db.from("campaigns").select("id, name, status").eq("user_id", clientId).order("created_at", { ascending: false });
      return json({ campaigns: data || [] });
    }

    if (action === "clear") {
      await db.from("ia_mod_messages").delete().eq("client_user_id", clientId);
      return json({ ok: true });
    }

    if (action === "save_notes") {
      const notes = String(body.notes || "").slice(0, 8000);
      await db.from("ia_mod_notes").upsert({ client_user_id: clientId, notes, updated_by: email, updated_at: new Date().toISOString() }, { onConflict: "client_user_id" });
      return json({ ok: true });
    }

    if (action === "confirm" || action === "cancel" || action === "undo") {
      const { data: ch } = await db.from("ia_mod_changes").select("*").eq("id", String(body.change_id || "")).eq("client_user_id", clientId).maybeSingle();
      if (!ch) return json({ error: "Cambio no encontrado" }, 404);
      if (action === "cancel") {
        if ((ch as any).status !== "pending") return json({ error: "Ese cambio ya no está pendiente" }, 409);
        await db.from("ia_mod_changes").update({ status: "cancelled", resolved_at: new Date().toISOString() }).eq("id", (ch as any).id);
        return json({ status: "cancelled" });
      }
      if (action === "confirm") {
        if ((ch as any).status !== "pending") return json({ error: "Ese cambio ya no está pendiente" }, 409);
        // Mismo camino que el "aplícalo" escrito: se aplica, se relee lo guardado y sólo entonces queda "applied".
        const r = await confirmarCambio(db, ch as any);
        if (r.status !== "applied") return json({ status: "failed", error: r.error, summary: mensajeResultado([r]) });
        return json({ status: "applied", summary: r.texto && r.texto !== r.summary ? `Aplicado y comprobado: ${r.texto}.` : mensajeResultado([r]) });
      }
      if ((ch as any).status !== "applied") return json({ error: "Sólo se puede deshacer un cambio aplicado" }, 409);
      const nota = await deshacer(db, ch as any, clientId);
      await db.from("ia_mod_changes").update({ status: "undone", resolved_at: new Date().toISOString() }).eq("id", (ch as any).id);
      return json({ status: "undone", summary: nota || null });
    }

    // Adjuntar un CSV: se crea el adjunto y luego se le añaden las filas por trozos.
    if (action === "upload_start") {
      const headers = (Array.isArray(body.headers) ? body.headers : []).map((h: unknown) => String(h).slice(0, 80)).slice(0, 120);
      const kind = body.kind === "tabla" ? "tabla" : body.kind === "documento" ? "documento" : "leads";
      if (kind === "leads" && !headers.includes("email")) return json({ error: "El archivo no tiene columna de email" }, 400);
      const esperadas = Math.max(0, Math.min(25000, Math.floor(Number(body.total) || 0)));
      const { data, error } = await db.from("ia_mod_uploads").insert({
        client_user_id: clientId, author_email: email, filename: String(body.filename || (kind === "documento" ? "documento.pdf" : "archivo.csv")).slice(0, 160),
        kind, headers, expected_rows: esperadas, discarded: Math.max(0, Math.floor(Number(body.discarded) || 0)),
      }).select("id").single();
      if (error) return json({ error: error.message }, 500);
      return json({ upload_id: (data as any).id });
    }
    if (action === "upload_append") {
      const filas = Array.isArray(body.rows) ? body.rows.slice(0, 2500) : [];
      const { data: up } = await db.from("ia_mod_uploads").select("id, client_user_id, author_email").eq("id", String(body.upload_id || "")).maybeSingle();
      if (!up || (up as any).client_user_id !== clientId) return json({ error: "Adjunto no encontrado" }, 404);
      const { data: n, error } = await db.rpc("ia_mod_upload_append", { p_id: (up as any).id, p_rows: filas });
      if (error) return json({ error: error.message }, 400);
      return json({ row_count: n });
    }

    if (action === "chat") {
      const uploadId = body.upload_id ? String(body.upload_id) : "";
      let adjunto: Record<string, unknown> | null = null;
      if (uploadId) {
        const { data: up } = await db.from("ia_mod_uploads").select("id, client_user_id, filename, kind, headers, row_count, expected_rows, discarded").eq("id", uploadId).maybeSingle();
        if (!up || (up as any).client_user_id !== clientId) return json({ error: "Adjunto no encontrado" }, 404);
        if ((up as any).expected_rows && (up as any).row_count < (up as any).expected_rows) return json({ error: "El archivo no se ha terminado de subir; vuelve a adjuntarlo" }, 400);
        adjunto = {
          type: "adjunto", upload_id: (up as any).id, nombre: (up as any).filename, tipo: (up as any).kind,
          filas: (up as any).row_count, descartadas: (up as any).discarded, columnas: (up as any).headers,
          summary: `Archivo ${(up as any).filename}`,
        };
      }
      const texto = (String(body.message || "").trim() || (adjunto ? `Te adjunto el archivo ${adjunto.nombre}.` : "")).slice(0, 6000);
      if (!texto) return json({ error: "Mensaje vacío" }, 400);
      // "Aplícalo" no necesita la IA: se resuelve sin ella (por eso la clave sólo se exige para conversar).
      // Si viene `contexto` es que el turno anterior lo llevó el consultor, no PulseBot: entonces el "aplícalo" no se refiere a
      // ninguna tarjeta pendiente de PulseBot y lo decide la IA con ese contexto.
      const intencion = adjunto || String(body.contexto || "").trim() ? null : intencionDeConfirmar(texto);
      if (!apiKey && !intencion) return json({ error: "Falta la clave de IA de la plataforma" }, 500);

      const { data: filaUsuario } = await db.from("ia_mod_messages")
        .insert({ client_user_id: clientId, author_email: email, role: "user", content: texto, cards: adjunto ? [adjunto] : [] })
        .select("id, role, content, cards, author_email, created_at").single();
      // Confirmar o cancelar ESCRITO ("sí", "aplícalo", "hazlo", "cancela"): se resuelven los pendientes de la última
      // respuesta del bot con el mismo código que el botón y el texto sale del resultado real, no de lo que la IA crea.
      if (intencion) {
        const directo = await aplicarPorTexto(db, cliente, intencion);
        if (directo) {
          const { data: fila } = await db.from("ia_mod_messages")
            .insert({ client_user_id: clientId, author_email: "ia", role: "assistant", content: directo.texto, cards: directo.tarjetas })
            .select("id, role, content, cards, author_email, created_at").single();
          return json({ message: fila, user_message: filaUsuario, changes: directo.estados });
        }
      }
      if (!apiKey) return json({ error: "Falta la clave de IA de la plataforma" }, 500);
      const reply = await conversar(db, apiKey, cliente, email, { contexto: String(body.contexto || "").slice(0, 3000), ia });
      const { data: row } = await db.from("ia_mod_messages")
        .insert({ client_user_id: clientId, author_email: "ia", role: "assistant", content: reply.texto, cards: reply.tarjetas })
        .select("id, role, content, cards, author_email, created_at").single();
      const ids = reply.tarjetas.map((t) => t.change_id).filter(Boolean) as string[];
      const { data: cambios } = ids.length ? await db.from("ia_mod_changes").select("id, status").in("id", ids) : { data: [] };
      // Resumir lo viejo y podar, por detrás: la respuesta no espera a esto.
      const memoria = mantenerMemoria(db, apiKey, clientId, ia).catch((e) => console.error("memoria:", e));
      const rt = (globalThis as any).EdgeRuntime;
      if (rt?.waitUntil) rt.waitUntil(memoria); else await memoria;
      return json({ message: row, user_message: filaUsuario, changes: Object.fromEntries((cambios || []).map((c: any) => [c.id, c.status])) });
    }

    return json({ error: "Acción desconocida" }, 400);
  } catch (e) {
    console.error("ia-modificaciones:", e);
    return json({ error: e instanceof Error ? e.message : "Error" }, 500);
  }
});

