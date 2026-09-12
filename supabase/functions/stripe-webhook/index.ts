// Webhook de Stripe — la pieza que faltaba.
//
// Hasta ahora el plan de un usuario sólo existía en el navegador: se calculaba en
// cada carga con una llamada a Stripe y no se guardaba en ningún sitio. Con eso
// no se puede aplicar ningún tope de verdad, porque el servidor no sabe qué plan
// tiene nadie. Este webhook mantiene `user_entitlements` al día cuando el cambio
// ocurre en Stripe (alta, cambio de plan, impago, baja, plazas de cliente).
//
// Configurar en Stripe → Developers → Webhooks:
//   URL     https://<proyecto>.supabase.co/functions/v1/stripe-webhook
//   Eventos customer.subscription.created / .updated / .deleted
//           invoice.payment_failed / invoice.paid
//   Y guardar el secreto de firma en STRIPE_WEBHOOK_SECRET.
//
// Sin STRIPE_WEBHOOK_SECRET la función responde 501 y NO procesa nada: aceptar
// eventos sin verificar la firma dejaría que cualquiera regalase plan.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@18.5.0?target=deno";

const TIER_BY_PRODUCT: Record<string, string> = {
  prod_U29mvQRMbo5m6f: "starter", prod_U29mwf36xp5tzO: "starter",
  prod_U29mEi2w9ltRwG: "growth",  prod_U29nlSXrrxJsWI: "growth",
  prod_U29nsLzCYygn4u: "scale",   prod_U29n2lYSL63LWg: "scale",
};

Deno.serve(async (req) => {
  const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET") || "";
  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY") || "";
  if (!secret || !stripeKey) {
    return new Response(JSON.stringify({ error: "webhook no configurado" }), {
      status: 501, headers: { "Content-Type": "application/json" },
    });
  }

  const sig = req.headers.get("stripe-signature");
  if (!sig) return new Response("sin firma", { status: 400 });

  const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
  const raw = await req.text();

  let event: Stripe.Event;
  try {
    // Verificación asíncrona: en Deno la síncrona no funciona.
    event = await stripe.webhooks.constructEventAsync(raw, sig, secret);
  } catch (e) {
    console.error("firma inválida:", (e as Error).message);
    return new Response("firma inválida", { status: 400 });
  }

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const slotPriceId = Deno.env.get("STRIPE_CLIENT_SLOT_PRICE_ID") || "";

  /** Del customer de Stripe al usuario nuestro: primero por el id que ya
   *  tengamos guardado, y si no, por email (es como se creó el cliente). */
  const findUserId = async (customerId: string): Promise<string | null> => {
    const { data: known } = await db.from("user_entitlements")
      .select("user_id").eq("stripe_customer_id", customerId).maybeSingle();
    if (known?.user_id) return known.user_id;
    try {
      const cust = await stripe.customers.retrieve(customerId);
      const email = (cust as Stripe.Customer).email?.toLowerCase();
      if (!email) return null;
      const { data: prof } = await db.from("profiles")
        .select("user_id").ilike("contact_email", email).maybeSingle();
      return prof?.user_id ?? null;
    } catch { return null; }
  };

  const applySubscription = async (sub: Stripe.Subscription, deleted = false) => {
    const customerId = String(sub.customer);
    const userId = await findUserId(customerId);
    if (!userId) { console.warn("evento de un customer sin usuario:", customerId); return; }

    let tier = "free";
    let extraSlots = 0;
    for (const it of sub.items.data) {
      const prod = String(it.price.product);
      if (TIER_BY_PRODUCT[prod]) tier = TIER_BY_PRODUCT[prod];
      else if (slotPriceId && it.price.id === slotPriceId) extraSlots += it.quantity || 0;
    }
    // Baja o impago: el plan deja de dar plazas, pero NO se borran los clientes
    // ya creados. Quedan por encima del tope y la interfaz lo dice; así nadie
    // pierde datos por un recibo devuelto.
    const inactive = deleted || ["canceled", "unpaid", "incomplete_expired"].includes(sub.status);

    const row: Record<string, unknown> = {
      user_id: userId,
      tier: inactive ? "free" : tier,
      status: deleted ? "canceled" : sub.status,
      stripe_customer_id: customerId,
      stripe_subscription_id: sub.id,
      current_period_end: (sub as any).current_period_end
        ? new Date((sub as any).current_period_end * 1000).toISOString() : null,
    };
    if (slotPriceId) row.extra_client_slots = inactive ? 0 : extraSlots;

    await db.from("user_entitlements").upsert(row, { onConflict: "user_id" });
    console.log(`derechos actualizados: ${userId} → ${row.tier}/${row.status}, plazas extra ${row.extra_client_slots ?? "(sin cambio)"}`);
  };

  try {
    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated":
        await applySubscription(event.data.object as Stripe.Subscription);
        break;
      case "customer.subscription.deleted":
        await applySubscription(event.data.object as Stripe.Subscription, true);
        break;
      case "invoice.payment_failed":
      case "invoice.paid": {
        // Se relee la suscripción: el estado que importa es el suyo, no el de la factura.
        const inv = event.data.object as Stripe.Invoice;
        const subId = (inv as any).subscription;
        if (subId) await applySubscription(await stripe.subscriptions.retrieve(String(subId)));
        break;
      }
      default:
        break; // el resto no nos afecta
    }
  } catch (e) {
    console.error("fallo procesando el evento:", (e as Error).message);
    // 500 para que Stripe reintente.
    return new Response("error", { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), { headers: { "Content-Type": "application/json" } });
});
