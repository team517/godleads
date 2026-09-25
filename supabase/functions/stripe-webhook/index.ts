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
//   Eventos checkout.session.completed
//           customer.subscription.created / .updated / .deleted
//           invoice.payment_failed / invoice.paid
//   Y guardar el secreto de firma en STRIPE_WEBHOOK_SECRET.
//
// Sin STRIPE_WEBHOOK_SECRET la función responde 501 y NO procesa nada: aceptar
// eventos sin verificar la firma dejaría que cualquiera regalase plan.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@18.5.0?target=deno";
import { leerSuscripcion } from "../_shared/stripe-plan.ts";


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

  /** Del customer de Stripe al usuario nuestro: primero por el id que ya tengamos guardado,
   *  luego por el correo de ACCESO de la cuenta y, por último, por el de contacto del perfil. */
  const customerEmail = async (customerId: string): Promise<string | null> => {
    try {
      const cust = await stripe.customers.retrieve(customerId);
      return ((cust as Stripe.Customer).email || "").trim().toLowerCase() || null;
    } catch { return null; }
  };
  const findUserId = async (customerId: string, email: string | null): Promise<string | null> => {
    const { data: known } = await db.from("user_entitlements")
      .select("user_id").eq("stripe_customer_id", customerId).maybeSingle();
    if (known?.user_id) return known.user_id;
    if (!email) return null;
    const { data: byLogin } = await db.rpc("user_id_by_email", { p_email: email });
    if (byLogin) return byLogin as string;
    const { data: prof } = await db.from("profiles")
      .select("user_id").ilike("contact_email", email).limit(1).maybeSingle();
    return prof?.user_id ?? null;
  };

  const applySubscription = async (sub: Stripe.Subscription, deleted = false) => {
    const lectura = leerSuscripcion(
      sub.items.data.map((it) => ({
        productId: String(typeof it.price.product === "string" ? it.price.product : (it.price.product as any)?.id || ""),
        priceId: it.price.id,
        quantity: it.quantity || 0,
        priceTier: (it.price.metadata || {}).tier || null,
      })),
      (sub.metadata || {}).tier || null,
      slotPriceId,
    );
    // Suscripción de otro negocio de la misma cuenta de Stripe: no es asunto nuestro.
    if (!lectura.esNuestra) { console.log("suscripción ajena, se ignora:", sub.id); return; }

    const customerId = String(sub.customer);
    const email = await customerEmail(customerId);
    const userId = await findUserId(customerId, email);

    // Baja o impago: el plan deja de dar plazas, pero NO se borran los clientes
    // ya creados. Quedan por encima del tope y la interfaz lo dice; así nadie
    // pierde datos por un recibo devuelto.
    const inactive = deleted || ["canceled", "unpaid", "incomplete_expired"].includes(sub.status);
    // En la API 2025 el fin de periodo vive en cada línea; en las anteriores, en la suscripción.
    const finPeriodo: number | null = (sub as any).current_period_end ?? (sub.items.data[0] as any)?.current_period_end ?? null;
    const row: Record<string, unknown> = {
      tier: inactive ? "free" : (lectura.tier || "free"),
      status: deleted ? "canceled" : sub.status,
      stripe_customer_id: customerId,
      stripe_subscription_id: sub.id,
      current_period_end: finPeriodo ? new Date(finPeriodo * 1000).toISOString() : null,
    };
    if (slotPriceId) row.extra_client_slots = inactive ? 0 : lectura.extraSlots;

    if (!userId) {
      // Pagó desde la landing y aún no tiene cuenta: se guarda por correo y se le asigna al
      // registrarse con ese correo (trigger on_auth_user_claim_plan).
      if (!email) { console.warn("suscripción sin correo ni usuario:", customerId); return; }
      const { error } = await db.from("pending_entitlements").upsert({ email, ...row, updated_at: new Date().toISOString() }, { onConflict: "email" });
      if (error) throw new Error(`pending_entitlements: ${error.message}`);
      console.log(`plan pendiente de registro: ${email} → ${row.tier}/${row.status}`);
      return;
    }

    const { error } = await db.from("user_entitlements").upsert({ user_id: userId, ...row }, { onConflict: "user_id" });
    if (error) throw new Error(`user_entitlements: ${error.message}`);
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
      case "checkout.session.completed": {
        // Enlace de pago de la landing: la suscripción ya existe al completar el pago.
        const ses = event.data.object as Stripe.Checkout.Session;
        if (ses.mode === "subscription" && ses.subscription) {
          await applySubscription(await stripe.subscriptions.retrieve(String(ses.subscription)));
        }
        break;
      }
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
