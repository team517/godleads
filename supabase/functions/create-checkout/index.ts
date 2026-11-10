// Checkout de Stripe desde la app (pantalla de prueba terminada, Ajustes → Plan, reactivación).
// 10-11-2026: sólo los 6 precios de Funnyleads; la suscripción lleva la misma metadata que los
// enlaces de la landing ({app: warmlead, plan}) y client_reference_id = usuario, para que el webhook
// la asigne sin depender del correo.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { PRECIOS_FUNNYLEADS } from "../_shared/stripe-plan.ts";

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
    const { data } = await db.auth.getUser(token);
    const user = data.user;
    if (!user?.email) throw new Error("User not authenticated");

    const { price_id } = await req.json();
    const precio = PRECIOS_FUNNYLEADS[String(price_id || "")];
    if (!precio) return json({ error: "Precio no válido" }, 400);

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
    // Se reutiliza el cliente de Stripe que ya tengamos guardado o el que lleve su correo.
    const { data: known } = await db.from("user_entitlements").select("stripe_customer_id").eq("user_id", user.id).maybeSingle();
    let customerId: string | undefined = known?.stripe_customer_id || undefined;
    if (!customerId) {
      const customers = await stripe.customers.list({ email: user.email, limit: 1 });
      if (customers.data.length > 0) customerId = customers.data[0].id;
    }

    const origin = req.headers.get("origin") || "http://localhost:3000";
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      customer_email: customerId ? undefined : user.email,
      client_reference_id: user.id,
      line_items: [{ price: price_id, quantity: 1 }],
      mode: "subscription",
      allow_promotion_codes: true,
      subscription_data: { metadata: { app: "warmlead", plan: precio.tier, billing: precio.interval === "year" ? "yearly" : "monthly", user_id: user.id } },
      success_url: `${origin}/settings?checkout=success`,
      cancel_url: `${origin}/settings?checkout=cancel`,
    });

    return json({ url: session.url });
  } catch (error) {
    return json({ error: (error as Error).message }, 500);
  }
});
