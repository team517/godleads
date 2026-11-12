// impersonate (10-11-2026): el equipo entra en la cuenta de un cliente sin contraseña y vuelve.
//
// El equipo (hello@onepulso.blog y equipo@onepulso.online, lista fija en _shared/impersonation-rules.ts)
// entra en cualquier cliente; una agencia (12-11-2026), sólo en los accesos de SUS clientes.
// Acciones (POST JSON, Authorization: Bearer <token de la cuenta del EQUIPO, nunca el del cliente>):
//   list               → todas las cuentas que NO son del equipo, para el diálogo "Clientes".
//   start {target_user_id} → token de un solo uso (hashed_token de un enlace mágico generado por el
//                        admin: NO se envía ningún correo) para que el navegador haga
//                        supabase.auth.verifyOtp({ token_hash, type: "magiclink" }). Queda registrado.
//   end {log_id}       → cierra el registro al volver a la cuenta propia.
// Se despliega con --no-verify-jwt: el token se valida aquí con auth.getUser.
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import {
  canImpersonate, decideStart, decideStartAgencia, ordenarClientes, tipoDeCuenta, AGENCY_EMAILS, type ClienteListado,
} from "../_shared/impersonation-rules.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ error: "No autorizado" }, 401);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: ud, error: ue } = await db.auth.getUser(token);
  const actor = ud?.user;
  if (ue || !actor) return json({ error: "No autorizado" }, 401);
  const actorEmail = String(actor.email || "").toLowerCase();
  // El equipo (hello@, equipo@) entra en cualquier cliente. Una AGENCIA (12-11-2026) sólo en los
  // accesos de SUS clientes: los de su tabla clients con login, si su plan incluye clientes.
  const equipo = canImpersonate(actorEmail);
  // login_user_id → su fila de clients (profiles.client_login_of apunta a clients.id, no al dueño).
  let suyos = new Map<string, { clientId: string; company: string | null; logo: string | null }>();
  let plazas = 0;
  if (!equipo) {
    const [{ data: cl }, { data: sl }] = await Promise.all([
      db.from("clients").select("id, login_user_id, name, company_name, logo_url").eq("owner_user_id", actor.id).is("archived_at", null).not("login_user_id", "is", null),
      db.rpc("client_slots_for", { p_user_id: actor.id }),
    ]);
    suyos = new Map((cl || []).map((c: any) => [c.login_user_id, { clientId: c.id, company: c.company_name || c.name || null, logo: c.logo_url || null }]));
    plazas = Number(sl) || 0;
    if (suyos.size === 0 || plazas <= 0) return json({ error: "Esta cuenta no puede entrar en otras" }, 403);
  }
  const modo = equipo ? "equipo" : "agencia";

  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "");

  try {
    if (action === "list" && !equipo) {
      // Agencia: sólo los accesos de sus clientes (y que de verdad sean accesos suyos).
      const ids = [...suyos.keys()];
      const [{ data: perfiles }, { data: activas }] = await Promise.all([
        db.from("profiles").select("user_id, full_name, company_name, avatar_url, logo_url, client_login_of, paused_by_admin_at").in("user_id", ids),
        db.from("campaigns").select("user_id").eq("status", "active").in("user_id", ids),
      ]);
      const nActivas = new Map<string, number>();
      for (const c of activas || []) nActivas.set((c as any).user_id, (nActivas.get((c as any).user_id) || 0) + 1);
      const lista: ClienteListado[] = [];
      for (const p of (perfiles || []) as any[]) {
        if (!suyos.has(p.user_id) || p.client_login_of !== suyos.get(p.user_id)!.clientId) continue;
        const { data: u } = await db.auth.admin.getUserById(p.user_id);
        const email = String(u?.user?.email || "").toLowerCase();
        if (!email || AGENCY_EMAILS.includes(email)) continue;
        const c = suyos.get(p.user_id);
        lista.push({
          id: p.user_id, email,
          company_name: c?.company || p.company_name || null,
          full_name: p.full_name || null,
          avatar_url: c?.logo || p.logo_url || p.avatar_url || null,
          tipo: "acceso_cliente", plan_tier: null, plan_status: null,
          active_campaigns: nActivas.get(p.user_id) || 0,
          last_sign_in_at: u?.user?.last_sign_in_at ?? null,
          paused_by_admin_at: p.paused_by_admin_at || null,
        });
      }
      return json({ clients: ordenarClientes(lista), mode: modo });
    }

    if (action === "list") {
      // Todas las cuentas de acceso (son pocas decenas; se pagina por si crece).
      const users: { id: string; email: string; last_sign_in_at: string | null }[] = [];
      for (let page = 1; page <= 20; page++) {
        const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
        if (error) throw new Error(error.message);
        for (const u of data.users) users.push({ id: u.id, email: String(u.email || "").toLowerCase(), last_sign_in_at: u.last_sign_in_at ?? null });
        if (data.users.length < 1000) break;
      }
      const ids = users.map((u) => u.id);
      const [{ data: perfiles }, { data: roles }, { data: planes }, { data: activas }] = await Promise.all([
        db.from("profiles").select("user_id, full_name, company_name, avatar_url, logo_url, allowed_routes, client_login_of, is_client_manager, paused_by_admin_at").in("user_id", ids),
        db.from("user_roles").select("user_id, role").in("user_id", ids),
        db.from("user_entitlements").select("user_id, tier, status").in("user_id", ids),
        db.from("campaigns").select("user_id").eq("status", "active"),
      ]);
      const perfil = new Map((perfiles || []).map((p: any) => [p.user_id, p]));
      const rol = new Map((roles || []).map((r: any) => [r.user_id, r.role]));
      const plan = new Map((planes || []).map((e: any) => [e.user_id, e]));
      const nActivas = new Map<string, number>();
      for (const c of activas || []) nActivas.set((c as any).user_id, (nActivas.get((c as any).user_id) || 0) + 1);

      const lista: ClienteListado[] = [];
      for (const u of users) {
        const p: any = perfil.get(u.id) || {};
        if (!u.email) continue;
        if (rol.get(u.id) === "admin" || p.is_client_manager || AGENCY_EMAILS.includes(u.email)) continue;
        const e: any = plan.get(u.id) || {};
        lista.push({
          id: u.id,
          email: u.email,
          company_name: p.company_name || null,
          full_name: p.full_name || null,
          avatar_url: p.logo_url || p.avatar_url || null,
          tipo: tipoDeCuenta(p),
          plan_tier: e.tier || null,
          plan_status: e.status || null,
          active_campaigns: nActivas.get(u.id) || 0,
          last_sign_in_at: u.last_sign_in_at,
          paused_by_admin_at: p.paused_by_admin_at || null,
        });
      }
      return json({ clients: ordenarClientes(lista), mode: modo });
    }

    if (action === "start") {
      const targetId = String(body.target_user_id || "");
      if (!/^[0-9a-f-]{36}$/i.test(targetId)) return json({ error: "Cuenta no válida" }, 400);
      const { data: tu } = await db.auth.admin.getUserById(targetId);
      const target = tu?.user || null;
      const [{ data: r }, { data: p }] = await Promise.all([
        db.from("user_roles").select("role").eq("user_id", targetId).maybeSingle(),
        db.from("profiles").select("is_client_manager, company_name, full_name, client_login_of").eq("user_id", targetId).maybeSingle(),
      ]);
      const info = target ? { id: target.id, email: target.email ?? null, role: (r as any)?.role ?? null, isClientManager: (p as any)?.is_client_manager ?? false } : null;
      const decision = equipo
        ? decideStart({ id: actor.id, email: actorEmail }, info)
        : decideStartAgencia({ id: actor.id, email: actorEmail }, info, {
            esSuyo: suyos.has(targetId) && (p as any)?.client_login_of === suyos.get(targetId)!.clientId,
            plazas,
          });
      if (!decision.ok) return json({ error: decision.error }, decision.status);

      const targetEmail = String(target!.email).toLowerCase();
      // generateLink sólo DEVUELVE el enlace: no envía correo al cliente ni cambia su contraseña.
      const { data: link, error: le } = await db.auth.admin.generateLink({ type: "magiclink", email: targetEmail });
      const hashed = (link as any)?.properties?.hashed_token;
      if (le || !hashed) return json({ error: `No se pudo abrir la cuenta: ${le?.message || "sin token"}` }, 500);

      const { data: log } = await db.from("impersonation_log").insert({
        actor_user_id: actor.id, actor_email: actorEmail, target_user_id: targetId, target_email: targetEmail,
        user_agent: (req.headers.get("user-agent") || "").slice(0, 300),
      }).select("id").single();
      console.log(`cambio de cuenta (${modo}): ${actorEmail} → ${targetEmail}`);
      return json({
        token_hash: hashed,
        target: { id: targetId, email: targetEmail, company: suyos.get(targetId)?.company || (p as any)?.company_name || (p as any)?.full_name || null },
        log_id: (log as any)?.id ?? null,
        mode: modo,
      });
    }

    if (action === "end") {
      const logId = String(body.log_id || "");
      if (/^[0-9a-f-]{36}$/i.test(logId)) {
        await db.from("impersonation_log").update({ ended_at: new Date().toISOString() })
          .eq("id", logId).eq("actor_user_id", actor.id).is("ended_at", null);
      }
      return json({ ok: true });
    }

    return json({ error: "Acción no válida" }, 400);
  } catch (e) {
    console.error("impersonate:", (e as Error).message);
    return json({ error: "Error interno" }, 500);
  }
});
