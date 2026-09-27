// "Modificaciones IA" — el chat del equipo (hello@, support@, equipo@) sobre la cuenta de un
// cliente. La IA (DeepSeek con herramientas) ve sus campañas, mensajes, métricas y respuestas,
// lee su web, guarda memoria del cliente y crea / edita / borra mensajes calcando los EJEMPLOS
// QUE FUNCIONAN. Todo cambio queda en ia_mod_changes con el antes y el después (se puede
// deshacer); borrar o meter un mensaje en medio espera a que el usuario pulse "Confirmar".
//
// Acciones: clients | history | campaigns | chat | confirm | cancel | undo | clear | save_notes
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { puedeUsarIaMod } from "../_shared/ia-mod.ts";
import { aplicarPendiente, cargarCliente, conversar, deshacer, listarClientes } from "./agente.ts";

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
    if (!puedeUsarIaMod(email)) return json({ error: "Sólo el equipo (hello@, support@, equipo@) puede usar Modificaciones IA" }, 403);

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");

    if (action === "clients") return json({ clients: await listarClientes(db) });

    // Todo lo demás es sobre UN cliente, y tiene que ser un cliente de verdad (cuenta creada por
    // la agencia), nunca una cuenta del equipo ni un registro propio.
    const clientId = String(body.client_id || "");
    const cliente = await cargarCliente(db, clientId);
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
        const r = await aplicarPendiente(db, ch as any);
        return json({ status: "applied", summary: r });
      }
      if ((ch as any).status !== "applied") return json({ error: "Sólo se puede deshacer un cambio aplicado" }, 409);
      await deshacer(db, ch as any, clientId);
      await db.from("ia_mod_changes").update({ status: "undone", resolved_at: new Date().toISOString() }).eq("id", (ch as any).id);
      return json({ status: "undone" });
    }

    if (action === "chat") {
      const texto = String(body.message || "").trim().slice(0, 6000);
      if (!texto) return json({ error: "Mensaje vacío" }, 400);
      const apiKey = Deno.env.get("DEEPSEEK_API_KEY") || "";
      if (!apiKey) return json({ error: "Falta la clave de IA de la plataforma" }, 500);

      await db.from("ia_mod_messages").insert({ client_user_id: clientId, author_email: email, role: "user", content: texto });
      const reply = await conversar(db, apiKey, cliente, email);
      const { data: row } = await db.from("ia_mod_messages")
        .insert({ client_user_id: clientId, author_email: "ia", role: "assistant", content: reply.texto, cards: reply.tarjetas })
        .select("id, role, content, cards, author_email, created_at").single();
      const ids = reply.tarjetas.map((t) => t.change_id).filter(Boolean) as string[];
      const { data: cambios } = ids.length ? await db.from("ia_mod_changes").select("id, status").in("id", ids) : { data: [] };
      return json({ message: row, changes: Object.fromEntries((cambios || []).map((c: any) => [c.id, c.status])) });
    }

    return json({ error: "Acción desconocida" }, 400);
  } catch (e) {
    console.error("ia-modificaciones:", e);
    return json({ error: e instanceof Error ? e.message : "Error" }, 500);
  }
});

