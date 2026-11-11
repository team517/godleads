// Comprueba en Stripe la suscripción del usuario que llama y la guarda en user_entitlements.
//
// El webhook es la vía normal; esto es el "Ya he pagado, comprobar" y la red de seguridad al
// arrancar la app cuando la fila falta o está vieja. 10-11-2026: mira TODAS las suscripciones del
// cliente (antes sólo las activas, así que una prueba de 14 días o un impago no se veían), elige la
// mejor nuestra (active > trialing > past_due > unpaid > …) y guarda prueba, renovación, intervalo,
// cancelación al final del periodo y último error de cobro.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { ESTADOS_CON_ACCESO, leerSuscripcion, publicStripeError, rangoEstado, tierDeMetadata } from "../_shared/stripe-plan.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) return json({ error: "Stripe no configurado (STRIPE_SECRET_KEY)", unconfigured: true }, 501);

    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "").trim();
    if (!token) throw new Error("No authorization header");

    const db = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false } });
    const { data: userData, error: userError } = await db.auth.getUser(token);
    const user = userData.user;
    if (userError || !user?.email) throw new Error(userError ? `User not authenticated: ${userError.message}` : "User not authenticated");

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
    const slotPriceId = Deno.env.get("STRIPE_CLIENT_SLOT_PRICE_ID") || "";

    // Clientes de Stripe con ese correo (puede haber más de uno si pagó dos veces desde la landing).
    const { data: known } = await db.from("user_entitlements").select("stripe_customer_id").eq("user_id", user.id).maybeSingle();
    const customers = await stripe.customers.list({ email: user.email, limit: 5 });
    const customerIds = new Set<string>(customers.data.map((c) => c.id));
    if (known?.stripe_customer_id) customerIds.add(known.stripe_customer_id);

    const guardar = async (row: Record<string, unknown>) => {
      const { error } = await db.from("user_entitlements").upsert({ user_id: user.id, ...row, last_event_at: new Date().toISOString() }, { onConflict: "user_id" });
      if (error) console.error("no se pudo guardar el derecho de plan:", error.message);
    };

    if (customerIds.size === 0) {
      await guardar({ tier: "free", status: "inactive" });
      return json({ subscribed: false, status: "inactive", tier: "free" });
    }

    // La mejor suscripción NUESTRA entre todas las del cliente.
    let mejor: { sub: Stripe.Subscription; lectura: ReturnType<typeof leerSuscripcion> } | null = null;
    for (const customerId of customerIds) {
      const subs = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 20, expand: ["data.items.data.price.product"] });
      for (const sub of subs.data) {
        const lectura = leerSuscripcion(
          sub.items.data.map((it) => ({
            productId: String(typeof it.price.product === "string" ? it.price.product : (it.price.product as any)?.id || ""),
            priceId: it.price.id,
            quantity: it.quantity || 0,
            priceTier: tierDeMetadata(it.price.metadata as any),
            productTier: typeof it.price.product === "object" ? tierDeMetadata((it.price.product as any)?.metadata) : null,
          })),
          tierDeMetadata(sub.metadata as any),
          slotPriceId,
        );
        if (!lectura.esNuestra) continue;
        if (!mejor || rangoEstado(sub.status) > rangoEstado(mejor.sub.status)
            || (rangoEstado(sub.status) === rangoEstado(mejor.sub.status) && sub.created > mejor.sub.created)) {
          mejor = { sub, lectura };
        }
      }
    }

    if (!mejor) {
      await guardar({ tier: "free", status: "inactive", stripe_customer_id: [...customerIds][0] });
      return json({ subscribed: false, status: "inactive", tier: "free" });
    }

    const { sub, lectura } = mejor;
    const finPeriodo: number | null = (sub as any).current_period_end ?? (sub.items.data[0] as any)?.current_period_end ?? null;
    const sinPlan = ["canceled", "incomplete_expired", "paused"].includes(sub.status);
    const row: Record<string, unknown> = {
      tier: sinPlan ? "free" : (lectura.tier || "free"),
      status: sub.status,
      stripe_customer_id: String(sub.customer),
      stripe_subscription_id: sub.id,
      current_period_end: finPeriodo ? new Date(finPeriodo * 1000).toISOString() : null,
      trial_end: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
      cancel_at_period_end: !!sub.cancel_at_period_end,
      billing_interval: sub.items.data[0]?.price?.recurring?.interval || null,
    };
    if ((ESTADOS_CON_ACCESO as readonly string[]).includes(sub.status)) row.last_payment_error = null;
    if (slotPriceId) row.extra_client_slots = sinPlan ? 0 : lectura.extraSlots;
    await guardar(row);

    return json({
      subscribed: (ESTADOS_CON_ACCESO as readonly string[]).includes(sub.status),
      status: sub.status,
      tier: row.tier,
      trial_end: row.trial_end,
      current_period_end: row.current_period_end,
      subscription_end: row.current_period_end, // compatibilidad con el frontend anterior
      cancel_at_period_end: row.cancel_at_period_end,
      product_id: String(typeof sub.items.data[0]?.price.product === "string" ? sub.items.data[0].price.product : (sub.items.data[0]?.price.product as any)?.id || ""),
      price_id: sub.items.data[0]?.price.id ?? null,
    });
  } catch (error) {
    const pub = publicStripeError(error);
    return json({ error: pub.message, stripe_unavailable: pub.stripeUnavailable }, pub.status);
  }
});
