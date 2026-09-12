// Clientes de usuario: crear, listar, editar y archivar — con el tope de plan
// aplicado EN EL SERVIDOR.
//
// Por qué existe esta función y no un insert directo desde el navegador: crear un
// cliente consume plaza de plan, y una plaza de plan es dinero. La tabla `clients`
// no tiene policy de INSERT a propósito, así que este es el único camino.
//
// Topes (una sola definición, en SQL: public.client_slots_for):
//   Starter → 0 clientes · Growth → 5 · Scale → 10 · + plazas extra compradas
//   Personal de la agencia (admin / is_client_manager) → sin tope
//
// Pasarse del tope NO se bloquea sin más: se ofrece comprar plazas a 15 $/mes
// cada una (acción `add_slots`), que añade cantidad a un item de la suscripción
// de Stripe. El precio está en una LISTA BLANCA del servidor: nunca se acepta un
// price_id del cliente (create-checkout sí lo hace y es un agujero conocido).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@18.5.0?target=deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Precio de la plaza extra de cliente (15 $/mes). Rellenar con el price id real
 *  de Stripe; mientras esté vacío, la compra de plazas responde 501 y el resto
 *  de la función (crear dentro del plan, listar, editar) funciona igual. */
const EXTRA_CLIENT_SLOT_PRICE_ID = Deno.env.get("STRIPE_CLIENT_SLOT_PRICE_ID") || "";
const EXTRA_CLIENT_SLOT_USD = 15;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const auth = req.headers.get("Authorization") || "";
    if (!auth.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    // Quién llama: se resuelve con el token, nunca con un user_id del cuerpo.
    const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
    });
    const { data: { user }, error: userErr } = await asUser.auth.getUser();
    if (userErr || !user) return json({ error: "Unauthorized" }, 401);

    const db = createClient(url, svc);
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "list");

    /** Plazas totales y cuántas se usan ya. */
    const readUsage = async () => {
      const [{ data: slotsRow }, { count }] = await Promise.all([
        db.rpc("client_slots_for", { p_user_id: user.id }),
        db.from("clients").select("id", { count: "exact", head: true })
          .eq("owner_user_id", user.id).is("archived_at", null),
      ]);
      const slots = Number(slotsRow ?? 0);
      const used = count ?? 0;
      const { data: ent } = await db.from("user_entitlements")
        .select("tier, status, extra_client_slots").eq("user_id", user.id).maybeSingle();
      return {
        slots,
        used,
        remaining: Math.max(0, slots - used),
        tier: ent?.tier ?? "free",
        status: ent?.status ?? "inactive",
        extra_slots: ent?.extra_client_slots ?? 0,
        extra_slot_price_usd: EXTRA_CLIENT_SLOT_USD,
        can_buy_slots: !!EXTRA_CLIENT_SLOT_PRICE_ID,
      };
    };

    // ── Listar ────────────────────────────────────────────────────────────────
    if (action === "list") {
      const { data: clients, error } = await db
        .from("clients")
        .select("id, name, company_name, contact_email, logo_url, brand_color, notes, created_at")
        .eq("owner_user_id", user.id)
        .is("archived_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;

      // Campañas y envíos por cliente, en dos consultas, no una por fila.
      const ids = (clients || []).map((c) => c.id);
      const stats: Record<string, { campaigns: number; sent: number; replied: number }> = {};
      for (const id of ids) stats[id] = { campaigns: 0, sent: 0, replied: 0 };
      if (ids.length) {
        const { data: camps } = await db.from("campaigns")
          .select("id, client_id").eq("user_id", user.id).in("client_id", ids);
        const byCampaign: Record<string, string> = {};
        for (const c of camps || []) {
          if (!c.client_id) continue;
          byCampaign[c.id] = c.client_id;
          if (stats[c.client_id]) stats[c.client_id].campaigns++;
        }
        const campIds = Object.keys(byCampaign);
        if (campIds.length) {
          const { data: sends } = await db.from("sent_emails")
            .select("campaign_id, replied_at").eq("user_id", user.id).in("campaign_id", campIds)
            .not("sent_at", "is", null).limit(50000);
          for (const s of sends || []) {
            const cid = byCampaign[s.campaign_id as string];
            if (!cid || !stats[cid]) continue;
            stats[cid].sent++;
            if (s.replied_at) stats[cid].replied++;
          }
        }
      }
      return json({ clients: (clients || []).map((c) => ({ ...c, stats: stats[c.id] })), usage: await readUsage() });
    }

    // ── Cuánto margen tengo ───────────────────────────────────────────────────
    if (action === "usage") return json({ usage: await readUsage() });

    // ── Crear ─────────────────────────────────────────────────────────────────
    if (action === "create") {
      const name = String(body?.name || "").trim();
      if (!name) return json({ error: "El nombre del cliente es obligatorio" }, 400);
      if (name.length > 120) return json({ error: "El nombre es demasiado largo" }, 400);

      const usage = await readUsage();
      if (usage.remaining <= 0) {
        // El tope se aplica AQUÍ, no en la interfaz.
        return json({
          error: "sin_plazas",
          message: usage.slots === 0
            ? "Tu plan no incluye clientes. Sube a Growth (5 clientes) o Scale (10)."
            : `Has usado las ${usage.slots} plazas de cliente de tu plan.`,
          usage,
        }, 402);
      }

      const email = String(body?.contact_email || "").trim().toLowerCase();
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Email no válido" }, 400);

      const { data: created, error } = await db.from("clients").insert({
        owner_user_id: user.id,
        name,
        company_name: String(body?.company_name || "").trim() || null,
        contact_email: email || null,
        logo_url: String(body?.logo_url || "").trim() || null,
        brand_color: String(body?.brand_color || "").trim() || null,
        notes: String(body?.notes || "").trim() || null,
      }).select("id, name, company_name, contact_email, logo_url, brand_color, notes, created_at").single();

      if (error) {
        // 23505 = choque con el índice único (owner + nombre en minúsculas)
        if ((error as any).code === "23505") return json({ error: "Ya tienes un cliente con ese nombre" }, 409);
        throw error;
      }
      return json({ client: { ...created, stats: { campaigns: 0, sent: 0, replied: 0 } }, usage: await readUsage() });
    }

    // ── Editar ────────────────────────────────────────────────────────────────
    if (action === "update") {
      const id = String(body?.id || "");
      if (!id) return json({ error: "Falta el id" }, 400);
      const patch: Record<string, unknown> = {};
      for (const f of ["name", "company_name", "contact_email", "logo_url", "brand_color", "notes"]) {
        if (body?.[f] !== undefined) {
          const v = String(body[f] ?? "").trim();
          patch[f] = v || (f === "name" ? undefined : null);
        }
      }
      if (patch.name === undefined) delete patch.name;
      if (!Object.keys(patch).length) return json({ error: "Nada que cambiar" }, 400);

      const { data: updated, error } = await db.from("clients").update(patch)
        .eq("id", id).eq("owner_user_id", user.id)   // el dueño, comprobado en el servidor
        .select("id, name, company_name, contact_email, logo_url, brand_color, notes, created_at").maybeSingle();
      if (error) {
        if ((error as any).code === "23505") return json({ error: "Ya tienes un cliente con ese nombre" }, 409);
        throw error;
      }
      if (!updated) return json({ error: "Cliente no encontrado" }, 404);
      return json({ client: updated });
    }

    // ── Archivar (libera la plaza y no borra el histórico) ────────────────────
    if (action === "archive") {
      const id = String(body?.id || "");
      if (!id) return json({ error: "Falta el id" }, 400);
      const { data: gone, error } = await db.from("clients")
        .update({ archived_at: new Date().toISOString() })
        .eq("id", id).eq("owner_user_id", user.id).is("archived_at", null)
        .select("id").maybeSingle();
      if (error) throw error;
      if (!gone) return json({ error: "Cliente no encontrado" }, 404);
      // Las campañas que apuntaban a él se quedan sin cliente, no se borran.
      await db.from("campaigns").update({ client_id: null }).eq("client_id", id).eq("user_id", user.id);
      return json({ ok: true, usage: await readUsage() });
    }

    // ── Comprar plazas extra (15 $/mes cada una) ──────────────────────────────
    if (action === "add_slots") {
      const qty = Math.max(1, Math.min(20, Number(body?.quantity) || 1));
      if (!EXTRA_CLIENT_SLOT_PRICE_ID) {
        return json({
          error: "precio_no_configurado",
          message: "Falta crear en Stripe el precio de la plaza extra (15 $/mes) y ponerlo en el secreto STRIPE_CLIENT_SLOT_PRICE_ID.",
        }, 501);
      }
      const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
      if (!stripeKey) return json({ error: "Stripe no configurado" }, 501);
      const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

      // La suscripción activa del usuario, por email (el patrón del resto de funciones).
      const customers = await stripe.customers.list({ email: user.email!, limit: 1 });
      if (!customers.data.length) return json({ error: "sin_suscripcion", message: "No encontramos tu suscripción." }, 409);
      const subs = await stripe.subscriptions.list({ customer: customers.data[0].id, status: "active", limit: 1 });
      if (!subs.data.length) return json({ error: "sin_suscripcion", message: "Necesitas una suscripción activa para añadir plazas." }, 409);
      const sub = subs.data[0];

      // Si ya existe el item de plazas, se le suma cantidad; si no, se crea.
      const existing = sub.items.data.find((it) => it.price.id === EXTRA_CLIENT_SLOT_PRICE_ID);
      if (existing) {
        await stripe.subscriptionItems.update(existing.id, {
          quantity: (existing.quantity || 0) + qty,
          proration_behavior: "create_prorations",
        });
      } else {
        await stripe.subscriptionItems.create({
          subscription: sub.id,
          price: EXTRA_CLIENT_SLOT_PRICE_ID,
          quantity: qty,
          proration_behavior: "create_prorations",
        });
      }

      // Se refleja ya en los derechos: el webhook lo reconciliará igualmente.
      const { data: ent } = await db.from("user_entitlements")
        .select("extra_client_slots").eq("user_id", user.id).maybeSingle();
      const next = (ent?.extra_client_slots ?? 0) + qty;
      await db.from("user_entitlements").upsert({
        user_id: user.id,
        extra_client_slots: next,
        stripe_customer_id: customers.data[0].id,
        stripe_subscription_id: sub.id,
      }, { onConflict: "user_id" });

      return json({ ok: true, added: qty, usage: await readUsage() });
    }

    return json({ error: "Acción no reconocida" }, 400);
  } catch (e) {
    console.error("clients:", (e as Error).message);
    return json({ error: (e as Error).message }, 500);
  }
});
