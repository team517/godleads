// Checkout de Stripe desde la app (pantalla de prueba terminada, Ajustes → Plan, reactivación).
// 11-11-2026: también el ALTA con prueba gratuita (body.trial = true): 14 días, tarjeta obligatoria y
// 0 € hoy. Sólo una prueba por cuenta (si ya tuvo una suscripción, se cobra sin prueba) y nunca si ya
// tiene una suscripción viva. Vuelve a /empezar (body.return_to = "empezar") o a Ajustes.
// 10-11-2026: sólo los 6 precios de Funnyleads; la suscripción lleva la misma metadata que los
// enlaces de la landing ({app: warmlead, plan}) y client_reference_id = usuario, para que el webhook
// la asigne sin depender del correo.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { PAGO_NO_DISPONIBLE, PRECIOS_FUNNYLEADS, checkoutConPrueba, precioAMedida, publicStripeError } from "../_shared/stripe-plan.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) return json({ error: PAGO_NO_DISPONIBLE, unconfigured: true }, 501);

    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "").trim();
    if (!token) throw new Error("No authorization header");
    const db = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false } });
    const { data } = await db.auth.getUser(token);
    const user = data.user;
    if (!user?.email) throw new Error("User not authenticated");

    const body = await req.json().catch(() => ({}));
    const price_id = String(body.price_id || "");
    // 11-11-2026: también los 20 precios del plan a medida (se pagan desde el primer día, sin prueba).
    const medida = precioAMedida(price_id);
    const precio = PRECIOS_FUNNYLEADS[price_id] ?? (medida ? { tier: "scale" as const, interval: medida.interval } : null);
    if (!precio) return json({ error: "Precio no válido" }, 400);
    const quierePrueba = body.trial === true;
    const volverAlAlta = body.return_to === "empezar";

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
    // Se reutiliza el cliente de Stripe que ya tengamos guardado o el que lleve su correo.
    const { data: known } = await db.from("user_entitlements").select("stripe_customer_id, stripe_subscription_id, status").eq("user_id", user.id).maybeSingle();
    // Ya tiene una suscripción de Stripe con acceso: no se abre otra (evita cobrar dos veces).
    if ((known?.status === "active" || known?.status === "trialing") && known?.stripe_subscription_id) {
      if (!medida) return json({ error: "Ya tienes una suscripción activa. Puedes cambiar de plan desde Ajustes.", already: true }, 409);
      // Pasar al plan a medida (o cambiar de nivel): se cambia el precio de SU suscripción, se cobra
      // ya la diferencia prorrateada y, si estaba en prueba, la prueba termina (el plan a medida se paga
      // desde el primer día). El webhook guarda los topes nuevos.
      const actual = await stripe.subscriptions.retrieve(known.stripe_subscription_id);
      const item = actual.items.data[0];
      if (!item) return json({ error: "No encontramos tu suscripción. Escríbenos a team@onepulso.online." }, 409);
      const mdMedida = { app: "warmlead", plan: "custom", level: String(medida.level.level), emails: String(medida.level.emails), contacts: String(medida.level.contacts), clients: String(medida.level.clients), billing: medida.interval === "year" ? "yearly" : "monthly", user_id: user.id };
      await stripe.subscriptions.update(actual.id, {
        items: [{ id: item.id, price: price_id }],
        proration_behavior: "always_invoice",
        payment_behavior: "error_if_incomplete",
        metadata: mdMedida,
        ...(actual.status === "trialing" ? { trial_end: "now" as const } : {}),
      });
      return json({ updated: true });
    }
    // Una sola prueba gratuita por cuenta: quien ya tuvo una suscripción paga desde el primer día.
    const conPrueba = checkoutConPrueba(price_id, quierePrueba, !!known?.stripe_subscription_id);
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
      // Tarjeta SIEMPRE, también en la prueba de 0 €: es lo que pidió el dueño.
      payment_method_collection: "always",
      subscription_data: {
        metadata: medida
          ? { app: "warmlead", plan: "custom", level: String(medida.level.level), emails: String(medida.level.emails), contacts: String(medida.level.contacts), clients: String(medida.level.clients), billing: medida.interval === "year" ? "yearly" : "monthly", user_id: user.id }
          : { app: "warmlead", plan: precio.tier, billing: precio.interval === "year" ? "yearly" : "monthly", user_id: user.id },
        ...(conPrueba ? { trial_period_days: 14, trial_settings: { end_behavior: { missing_payment_method: "cancel" } } } : {}),
      },
      ...(medida ? { metadata: { app: "warmlead", plan: "custom", level: String(medida.level.level), billing: medida.interval === "year" ? "yearly" : "monthly" } } : {}),
      success_url: volverAlAlta ? `${origin}/empezar?paso=listo` : `${origin}/settings?checkout=success`,
      cancel_url: volverAlAlta ? `${origin}/empezar?paso=tarjeta&cancelado=1` : `${origin}/settings?checkout=cancel`,
    });

    return json({ url: session.url, trial: conPrueba });
  } catch (error) {
    const pub = publicStripeError(error);
    console.error("[create-checkout]", (error as any)?.type || "", pub.stripeUnavailable ? "Stripe no disponible (clave o conexión)" : pub.message);
    return json({ error: pub.message, stripe_unavailable: pub.stripeUnavailable }, pub.status);
  }
});
