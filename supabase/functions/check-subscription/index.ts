import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/** Los productos de cada plan, la misma lista que PLAN_CONFIG en el frontend.
 *  Aquí abajo es la que MANDA: el tope de clientes se aplica en el servidor y no
 *  puede depender de lo que diga el navegador. */
const TIER_BY_PRODUCT: Record<string, string> = {
  prod_U29mvQRMbo5m6f: "starter", prod_U29mwf36xp5tzO: "starter",
  prod_U29mEi2w9ltRwG: "growth",  prod_U29nlSXrrxJsWI: "growth",
  prod_U29nsLzCYygn4u: "scale",   prod_U29n2lYSL63LWg: "scale",
};

/** Guarda el plan en user_entitlements. Hasta ahora el plan sólo existía en el
 *  navegador, así que ningún tope podía ser real. Esta función se llama en cada
 *  carga de la app, por lo que los derechos quedan frescos sin depender del
 *  webhook (que además existe, para cuando el cambio ocurre en Stripe). */
async function saveEntitlement(db: any, userId: string, e: {
  tier: string; status: string; customerId?: string | null;
  subscriptionId?: string | null; periodEnd?: string | null; extraSlots?: number | null;
}) {
  const row: Record<string, unknown> = {
    user_id: userId, tier: e.tier, status: e.status,
    stripe_customer_id: e.customerId ?? null,
    stripe_subscription_id: e.subscriptionId ?? null,
    current_period_end: e.periodEnd ?? null,
  };
  // Sólo se pisan las plazas extra cuando Stripe nos dice cuántas hay.
  if (typeof e.extraSlots === "number") row.extra_client_slots = e.extraSlots;
  try {
    await db.from("user_entitlements").upsert(row, { onConflict: "user_id" });
  } catch (err) {
    console.error("no se pudo guardar el derecho de plan:", (err as Error).message);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");

    const token = authHeader.replace("Bearer ", "").trim();
    if (!token) throw new Error("Invalid authorization header");

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !serviceRoleKey) throw new Error("Backend auth configuration missing");

    const authClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });
    const { data: userData, error: userError } = await authClient.auth.getUser(token);
    const user = userData.user;
    if (userError || !user?.email) {
      throw new Error(userError ? `User not authenticated: ${userError.message}` : "User not authenticated");
    }

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
    const customers = await stripe.customers.list({ email: user.email, limit: 1 });

    if (customers.data.length === 0) {
      await saveEntitlement(authClient, user.id, { tier: "free", status: "inactive" });
      return new Response(JSON.stringify({ subscribed: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const customerId = customers.data[0].id;

    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: "active",
      limit: 1,
    });

    if (subscriptions.data.length === 0) {
      await saveEntitlement(authClient, user.id, { tier: "free", status: "inactive", customerId });
      return new Response(JSON.stringify({ subscribed: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sub = subscriptions.data[0];
    // El item del plan es el que tiene un producto conocido; cualquier otro item
    // (por ejemplo las plazas de cliente a 15 $/mes) se cuenta por su cantidad.
    const slotPriceId = Deno.env.get("STRIPE_CLIENT_SLOT_PRICE_ID") || "";
    let tier = "free";
    let extraSlots = 0;
    for (const it of sub.items.data) {
      const prod = String(it.price.product);
      if (TIER_BY_PRODUCT[prod]) tier = TIER_BY_PRODUCT[prod];
      else if (slotPriceId && it.price.id === slotPriceId) extraSlots += it.quantity || 0;
    }
    const periodEnd = new Date(sub.current_period_end * 1000).toISOString();
    await saveEntitlement(authClient, user.id, {
      tier, status: sub.status, customerId, subscriptionId: sub.id, periodEnd,
      extraSlots: slotPriceId ? extraSlots : undefined,
    });

    return new Response(JSON.stringify({
      subscribed: true,
      product_id: sub.items.data[0].price.product,
      price_id: sub.items.data[0].price.id,
      subscription_end: new Date(sub.current_period_end * 1000).toISOString(),
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
