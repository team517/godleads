import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  canUsePlacement, providerOf, resultsForClient, summarizePlacement,
  PLACEMENT_AGENCY_EMAILS, PLACEMENT_DAILY_CAP, type PlacementFolder, type SeedResult,
} from "../_shared/placement.ts";
import { imapLocate, type Seed } from "../_shared/imap-locate.ts";

// ─────────────────────────────────────────────────────────────────────────────
// TEST DE ENTREGABILIDAD (¿Bandeja o Spam?).
//
// Envía el copy que elige el usuario — con las variables ya sustituidas — desde UNA de sus
// cuentas a los buzones semilla, y luego mira por IMAP en qué carpeta cayó cada uno.
//
//  · El envío sale por `send-email` (is_test): la MISMA tubería que un correo real (MIME,
//    firma, List-Unsubscribe, texto plano). Nada de un emisor aparte que mida otra cosa.
//  · No se toca el asunto: cada correo se localiza por su Message-ID, no por un código pegado
//    al asunto (que cambiaba justo lo que se quería medir).
//  · Los buzones semilla son de la PLATAFORMA (los de la agencia). Un cliente nunca ve sus
//    direcciones: sólo proveedor + carpeta. Viven en placement_seeds, fuera de email_accounts,
//    así que jamás entran en el Unibox ni en el motor de envío.
//
// Acciones: access · run · check.
// ─────────────────────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-supabase-api-version",
};

function rand(n: number) { const a = "abcdefghijklmnopqrstuvwxyz0123456789"; let s = ""; for (let i = 0; i < n; i++) s += a[Math.floor(Math.random() * a.length)]; return s; }
const withTimeout = <T,>(p: Promise<T>, ms: number, what: string): Promise<T> =>
  Promise.race([p, new Promise<T>((_, r) => setTimeout(() => r(new Error(`timeout ${what}`)), ms))]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
    const { data: u } = await userClient.auth.getUser();
    if (!u?.user) return json({ error: "No autorizado" }, 401);
    const user = u.user;
    const admin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

    const body = (await req.json().catch(() => ({}))) as Record<string, any>;
    const action = String(body.action || "");

    // ── Quién es y si puede usarlo ──
    const [{ data: roleRow }, { data: prof }, { data: ent }] = await Promise.all([
      admin.from("user_roles").select("role").eq("user_id", user.id).maybeSingle(),
      admin.from("profiles").select("is_client_manager, allowed_routes, created_at").eq("user_id", user.id).maybeSingle(),
      admin.from("user_entitlements").select("tier, status").eq("user_id", user.id).maybeSingle(),
    ]);
    const access = canUsePlacement({
      email: user.email ?? null,
      role: (roleRow as any)?.role ?? null,
      isClientManager: !!(prof as any)?.is_client_manager,
      allowedRoutes: (prof as any)?.allowed_routes ?? null,
      createdAt: user.created_at || (prof as any)?.created_at || null,
      entitlementTier: (ent as any)?.tier ?? null,
      entitlementStatus: (ent as any)?.status ?? null,
    });
    const agency = access.allowed && access.agency;

    // ── Buzones semilla: la agencia usa los suyos si los tiene; todos los demás, los de la
    //    plataforma (= los que mantiene la agencia). ──
    const loadSeeds = async (): Promise<{ seeds: Seed[]; pool: "own" | "platform" }> => {
      if (agency) {
        const { data: own } = await admin.from("placement_seeds").select("*").eq("user_id", user.id);
        if (own && own.length) return { seeds: own as Seed[], pool: "own" };
      }
      const { data: all } = await admin.from("placement_seeds").select("*");
      const owners = [...new Set((all || []).map((s: any) => s.user_id as string))];
      const agencyOwners = new Set<string>();
      for (const id of owners) {
        const { data: o } = await admin.auth.admin.getUserById(id);
        if (PLACEMENT_AGENCY_EMAILS.includes((o?.user?.email || "").toLowerCase())) agencyOwners.add(id);
      }
      return { seeds: ((all || []) as Seed[]).filter((s) => agencyOwners.has(s.user_id)), pool: "platform" };
    };

    const usedToday = async () => {
      const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const { count } = await admin.from("placement_tests").select("id", { count: "exact", head: true }).eq("user_id", user.id).gte("created_at", since);
      return count || 0;
    };

    if (action === "access") {
      if (!access.allowed) return json({ allowed: false, reason: access.reason });
      const { seeds } = await loadSeeds();
      const providers = [...new Set(seeds.map((s) => providerOf(s.email)))];
      return json({ allowed: true, agency, ready: seeds.length > 0, providers, remaining: agency ? null : Math.max(0, PLACEMENT_DAILY_CAP - await usedToday()) });
    }

    if (!access.allowed) return json({ error: access.reason, code: "plan_required" }, 402);

    if (action === "run") {
      const accountId = String(body.account_id || "");
      const rawSubject = String(body.subject || "").replace(/[\r\n]+/g, " ").trim();
      // La página antigua (hasta que se publique la nueva) sólo mandaba el asunto: conserva su texto por defecto.
      const rawBody = String(body.body ?? body.html ?? "").trim()
        || ["Hola,", "Este es un correo de prueba para ver dónde aterriza. Puedes ignorarlo.", "Un saludo."].join("\n\n");
      if (!rawSubject) return json({ error: "Falta el asunto." }, 400);
      if (rawBody.length > 60000) return json({ error: "El correo es demasiado largo para la prueba." }, 400);

      const { data: acc } = await admin.from("email_accounts")
        .select("id, email, first_name, last_name, status, smtp_host, signature_html, tags")
        .eq("id", accountId).eq("user_id", user.id).maybeSingle();
      if (!acc || !(acc as any).smtp_host) return json({ error: "Cuenta de envío no válida." }, 400);
      if ((acc as any).status !== "connected") return json({ error: "Esa cuenta no está conectada. Verifícala en Cuentas de Email." }, 400);

      if (!agency && await usedToday() >= PLACEMENT_DAILY_CAP) {
        return json({ error: `Has llegado al máximo de ${PLACEMENT_DAILY_CAP} pruebas en 24 horas. Vuelve a intentarlo más tarde.`, code: "daily_cap" }, 429);
      }

      const { seeds, pool } = await loadSeeds();
      if (seeds.length === 0) {
        return json({ error: agency ? "No hay buzones semilla. Añádelos abajo (Gmail, Outlook… con su IMAP)." : "El test no está disponible ahora mismo. Inténtalo más tarde." }, 503);
      }

      // Campaña (opcional): firma y enlace de baja como en el envío real.
      let campaignSignature: string | null = null;
      let includeUnsub = false;
      const campaignId = body.campaign_id ? String(body.campaign_id) : null;
      if (campaignId) {
        const { data: camp } = await admin.from("campaigns")
          .select("signature_html, include_unsubscribe, unsubscribe_all, unsubscribe_account_ids, unsubscribe_account_tags")
          .eq("id", campaignId).eq("user_id", user.id).maybeSingle();
        if (!camp) return json({ error: "Campaña no encontrada." }, 404);
        campaignSignature = (camp as any).signature_html || null;
        if ((camp as any).include_unsubscribe) {
          const tags = ((acc as any).tags || []) as string[];
          includeUnsub = ((camp as any).unsubscribe_all ?? true)
            || ((camp as any).unsubscribe_account_ids || []).includes(accountId)
            || tags.some((t) => ((camp as any).unsubscribe_account_tags || []).includes(t));
        }
      }

      // Datos con los que se rellena el copy (los del lead de ejemplo + los del remitente).
      const fields: Record<string, string> = {};
      for (const [k, v] of Object.entries((body.fields && typeof body.fields === "object") ? body.fields : {})) {
        if (typeof k === "string" && k.length <= 60) fields[k] = String(v ?? "").slice(0, 500);
      }
      if ((acc as any).first_name) fields["SenderFirstName"] = (acc as any).first_name;
      if ((acc as any).last_name) fields["SenderLastName"] = (acc as any).last_name;
      fields["SenderEmail"] = (acc as any).email;

      const messageIds: Record<string, string> = {};
      let sent = 0;
      let lastError = "";
      for (const [i, s] of seeds.entries()) {
        if (i > 0) await sleep(1200);
        try {
          const resp = await withTimeout(fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: authHeader, apikey: Deno.env.get("SUPABASE_ANON_KEY")! },
            body: JSON.stringify({
              account_id: accountId, to_email: s.email, subject: rawSubject, body: rawBody,
              custom_fields: { ...fields, Email: s.email, email: s.email },
              is_test: true, include_unsubscribe: includeUnsub,
              signature_html: (acc as any).signature_html || campaignSignature || undefined,
            }),
          }), 60000, "send-email");
          const out = await resp.json().catch(() => ({}));
          if (resp.ok && out?.messageId) { messageIds[s.id] = String(out.messageId); sent++; }
          else lastError = String(out?.error || `HTTP ${resp.status}`);
        } catch (e) { lastError = String((e as Error)?.message || e); }
      }
      if (sent === 0) {
        // El fallo es de la cuenta del propio usuario (SMTP); se limpia cualquier dirección semilla.
        const safe = lastError.replace(/[^\s<>"@]+@[^\s<>"@]+\.[^\s<>"@]+/g, "el buzón de prueba");
        return json({ error: `No se pudo enviar la prueba desde ${(acc as any).email}: ${safe}` }, 502);
      }

      const { data: test, error: insErr } = await admin.from("placement_tests").insert({
        user_id: user.id, from_account_id: (acc as any).id, from_email: (acc as any).email, subject: rawSubject.slice(0, 300),
        token: "mid-" + rand(10), seeds: sent, status: "sent",
        results: { v: 2, pool, campaign_id: campaignId, message_ids: messageIds, items: [] },
      }).select("id").single();
      if (insErr) return json({ error: insErr.message }, 500);
      return json({ ok: true, test_id: (test as any).id, seeds: sent, sent });
    }

    if (action === "check") {
      const { data: test } = await admin.from("placement_tests").select("*").eq("id", String(body.test_id || "")).eq("user_id", user.id).maybeSingle();
      if (!test) return json({ error: "Prueba no encontrada." }, 404);
      const meta = (test as any).results;
      let results: Array<SeedResult & { seed_id?: string }> = [];

      if (meta && !Array.isArray(meta) && meta.v === 2) {
        const ids = Object.keys(meta.message_ids || {});
        const { data: seedRows } = ids.length ? await admin.from("placement_seeds").select("*").in("id", ids) : { data: [] as any[] };
        const byId = new Map<string, Seed>((seedRows || []).map((s: any) => [s.id, s as Seed]));
        // Los ya localizados no se vuelven a consultar: sólo los que faltaban.
        const previous = new Map<string, PlacementFolder>((meta.items || []).map((it: any) => [it.seed_id, it.folder]));
        results = await Promise.all(ids.map(async (id) => {
          const seed = byId.get(id);
          if (!seed) return { seed_id: id, provider: "otro", folder: "error" as PlacementFolder };
          const before = previous.get(id);
          const folder = (before === "inbox" || before === "promotions" || before === "spam")
            ? before
            : await imapLocate(seed, { messageId: meta.message_ids[id] });
          return { seed_id: id, email: seed.email, provider: providerOf(seed.email), folder };
        }));
      } else {
        // Prueba antigua: el código iba en el asunto y los buzones eran los del propio usuario.
        const { data: own } = await admin.from("placement_seeds").select("*").eq("user_id", user.id);
        results = await Promise.all(((own || []) as Seed[]).map(async (s) => ({
          seed_id: s.id, email: s.email, provider: providerOf(s.email), folder: await imapLocate(s, { subjectToken: (test as any).token }),
        })));
      }

      const summary = summarizePlacement(results);
      const stored = results.map((r) => ({ seed_id: r.seed_id, provider: r.provider, folder: r.folder })); // sin direcciones
      await admin.from("placement_tests").update({
        inbox: summary.inbox + summary.promotions, spam: summary.spam, missing: summary.missing + summary.error,
        results: (meta && !Array.isArray(meta) && meta.v === 2) ? { ...meta, items: stored } : stored,
        status: summary.missing > 0 ? "sent" : "done",
      }).eq("id", (test as any).id);

      return json({
        ok: true, summary, inbox: summary.inbox + summary.promotions, spam: summary.spam, missing: summary.missing,
        inbox_pct: summary.inboxPct ?? 0,
        // La agencia ve qué buzón es cada uno; un cliente, sólo proveedor y carpeta.
        results: agency ? results.map((r) => ({ email: r.email, provider: r.provider, folder: r.folder })) : resultsForClient(results),
      });
    }

    return json({ error: "action debe ser 'access', 'run' o 'check'" }, 400);
  } catch (e) {
    return json({ error: String((e as any)?.message || e) }, 500);
  }
});
