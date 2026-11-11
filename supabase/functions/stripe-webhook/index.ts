// Webhook de Stripe: mantiene `user_entitlements` al día cuando el cambio ocurre en Stripe (alta
// con 14 días de prueba desde la landing, cobro, impago, baja, plazas de cliente).
//
// Configurar en Stripe → Developers → Webhooks:
//   URL     https://<proyecto>.supabase.co/functions/v1/stripe-webhook
//   Eventos checkout.session.completed
//           customer.subscription.created / .updated / .deleted
//           invoice.paid / invoice.payment_failed
//   Y guardar el secreto de firma en STRIPE_WEBHOOK_SECRET (y la clave en STRIPE_SECRET_KEY).
//
// Sin STRIPE_WEBHOOK_SECRET la función responde 501 y NO procesa nada: aceptar eventos sin
// verificar la firma dejaría que cualquiera regalase plan.
//
// 10-11-2026: estados completos (trialing/active/past_due/unpaid/canceled/incomplete*/paused),
// trial_end, cancel_at_period_end, billing_interval, last_payment_error, y registro idempotente en
// billing_events (un evento repetido por Stripe responde 200 sin reprocesar).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@18.5.0?target=deno";
import { ESTADOS_BAJA, ESTADOS_IMPAGO, camposAMedida, filaDesdeSesionDeEnlace, leerSuscripcion, tierDeMetadata } from "../_shared/stripe-plan.ts";

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET") || "";
  // 11-11-2026: la firma sólo necesita el secreto del webhook. Sin una clave válida se procesa igual
  // con lo que trae el aviso (las consultas a Stripe fallan y se usan los datos del evento).
  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY") || "sk_sin_configurar";
  if (!secret) return json({ error: "webhook no configurado" }, 501);

  const sig = req.headers.get("stripe-signature");
  if (!sig) return new Response("sin firma", { status: 400 });

  const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
  const raw = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(raw, sig, secret); // en Deno la síncrona no va
  } catch (e) {
    console.error("firma inválida:", (e as Error).message);
    return new Response("firma inválida", { status: 400 });
  }

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const slotPriceId = Deno.env.get("STRIPE_CLIENT_SLOT_PRICE_ID") || "";

  // Idempotencia: Stripe reintenta y a veces duplica. Un evento ya registrado no se reprocesa.
  const { data: visto } = await db.from("billing_events").select("id").eq("stripe_event_id", event.id).maybeSingle();
  if (visto) return json({ received: true, duplicate: true });

  const registrar = async (fields: Record<string, unknown>) => {
    const { error } = await db.from("billing_events").insert({
      stripe_event_id: event.id, type: event.type, payload: { id: event.id, created: event.created, object: (event.data.object as any)?.id ?? null },
      ...fields,
    });
    // Un evento repetido que llegó en paralelo choca con el único: no es un error.
    if (error && !/duplicate|unique/i.test(error.message)) console.error("billing_events:", error.message);
  };

  /** Del customer de Stripe al usuario nuestro: por el id guardado, por el correo de ACCESO y, al
   *  final, por el correo de contacto del perfil. */
  const customerEmail = async (customerId: string): Promise<string | null> => {
    try {
      const cust = await stripe.customers.retrieve(customerId);
      return ((cust as Stripe.Customer).email || "").trim().toLowerCase() || null;
    } catch { return null; }
  };
  const findUserId = async (customerId: string, email: string | null, clientRef?: string | null): Promise<string | null> => {
    if (clientRef && /^[0-9a-f-]{36}$/i.test(clientRef)) {
      // Sólo si el usuario existe (un id inventado en el enlace no crea filas huérfanas).
      const { data: u } = await db.auth.admin.getUserById(clientRef);
      if (u?.user) return clientRef;
    }
    const { data: known } = await db.from("user_entitlements").select("user_id").eq("stripe_customer_id", customerId).maybeSingle();
    if (known?.user_id) return known.user_id;
    if (!email) return null;
    const { data: byLogin } = await db.rpc("user_id_by_email", { p_email: email });
    if (byLogin) return byLogin as string;
    const { data: prof } = await db.from("profiles").select("user_id").ilike("contact_email", email).limit(1).maybeSingle();
    return prof?.user_id ?? null;
  };

  const applySubscription = async (sub: Stripe.Subscription, opts: { deleted?: boolean; paymentError?: string | null; clientRef?: string | null } = {}) => {
    const lectura = leerSuscripcion(
      sub.items.data.map((it) => ({
        productId: String(typeof it.price.product === "string" ? it.price.product : (it.price.product as any)?.id || ""),
        priceId: it.price.id,
        quantity: it.quantity || 0,
        priceTier: tierDeMetadata(it.price.metadata as any),
        productTier: typeof it.price.product === "object" ? tierDeMetadata((it.price.product as any)?.metadata) : null,
        priceLevel: (it.price.metadata as any)?.level ?? null,
      })),
      tierDeMetadata(sub.metadata as any),
      slotPriceId,
      (sub.metadata as any)?.level ?? null,
    );
    // Suscripción de otro negocio de la misma cuenta de Stripe: no es asunto nuestro.
    if (!lectura.esNuestra) { console.log("suscripción ajena, se ignora:", sub.id); return null; }

    const customerId = String(sub.customer);
    const email = await customerEmail(customerId);
    const userId = await findUserId(customerId, email, opts.clientRef ?? ((sub.metadata as any)?.user_id || null));

    const status = opts.deleted ? "canceled" : sub.status;
    const sinPlan = opts.deleted || (ESTADOS_BAJA as readonly string[]).includes(status) || status === "incomplete_expired";
    // En la API 2025 el fin de periodo vive en cada línea; en las anteriores, en la suscripción.
    const finPeriodo: number | null = (sub as any).current_period_end ?? (sub.items.data[0] as any)?.current_period_end ?? null;
    const interval = sub.items.data[0]?.price?.recurring?.interval || null;
    const row: Record<string, unknown> = {
      // Con impago el plan se conserva (la pantalla de bloqueo dice qué plan es); con baja → free.
      tier: sinPlan ? "free" : (lectura.tier || "free"),
      status,
      stripe_customer_id: customerId,
      stripe_subscription_id: sub.id,
      current_period_end: finPeriodo ? new Date(finPeriodo * 1000).toISOString() : null,
      trial_end: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
      cancel_at_period_end: !!sub.cancel_at_period_end,
      billing_interval: interval,
      last_event_at: new Date().toISOString(),
      // Plan a medida: sus topes (envíos, contactos, clientes). Con baja se vacían.
      ...camposAMedida(lectura.custom, opts.deleted || (ESTADOS_BAJA as readonly string[]).includes(status) || status === "incomplete_expired"),
    };
    if (opts.paymentError !== undefined) row.last_payment_error = opts.paymentError;
    else if ((["active", "trialing"] as string[]).includes(status)) row.last_payment_error = null;
    // Baja o impago: el plan deja de dar plazas, pero NO se borran los clientes creados.
    if (slotPriceId) row.extra_client_slots = (sinPlan || (ESTADOS_IMPAGO as readonly string[]).includes(status)) ? 0 : lectura.extraSlots;

    if (!userId) {
      // Pagó desde la landing y aún no tiene cuenta: se guarda por correo y se le asigna al
      // registrarse con ese correo (trigger on_auth_user_claim_plan).
      if (!email) { console.warn("suscripción sin correo ni usuario:", customerId); return { email: null, userId: null, row }; }
      const { last_payment_error: _e, last_event_at: _t, ...pend } = row;
      const { error } = await db.from("pending_entitlements").upsert({ email, ...pend, updated_at: new Date().toISOString() }, { onConflict: "email" });
      if (error) throw new Error(`pending_entitlements: ${error.message}`);
      console.log(`plan pendiente de registro: ${email} → ${row.tier}/${row.status}`);
      return { email, userId: null, row };
    }

    const { error } = await db.from("user_entitlements").upsert({ user_id: userId, ...row }, { onConflict: "user_id" });
    if (error) throw new Error(`user_entitlements: ${error.message}`);
    console.log(`derechos actualizados: ${userId} → ${row.tier}/${row.status}`);
    return { email, userId, row };
  };

  try {
    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const r = await applySubscription(event.data.object as Stripe.Subscription);
        await registrar({ user_id: r?.userId ?? null, email: r?.email ?? null, tier: r?.row.tier ?? null, status: r?.row.status ?? null });
        break;
      }
      case "customer.subscription.deleted": {
        const r = await applySubscription(event.data.object as Stripe.Subscription, { deleted: true });
        await registrar({ user_id: r?.userId ?? null, email: r?.email ?? null, tier: r?.row.tier ?? null, status: "canceled" });
        break;
      }
      case "checkout.session.completed": {
        const ses = event.data.object as Stripe.Checkout.Session;
        const email = (ses.customer_details?.email || ses.customer_email || "").toLowerCase() || null;
        if (ses.mode === "subscription" && ses.subscription) {
          // Enlace de pago de la landing o checkout de la app: la suscripción ya existe al completar.
          let sub: Stripe.Subscription | null = null;
          try { sub = await stripe.subscriptions.retrieve(String(ses.subscription)); }
          catch (e) { console.warn("no se pudo leer la suscripción en Stripe, se usa el aviso:", (e as any)?.type || "error"); }
          if (sub) {
            const r = await applySubscription(sub, { clientRef: ses.client_reference_id });
            await registrar({ user_id: r?.userId ?? null, email: r?.email ?? email, tier: r?.row.tier ?? null, status: r?.row.status ?? null, amount_cents: ses.amount_total ?? null, currency: ses.currency ?? null });
          } else {
            // Plan B (clave de Stripe mal o caída): el enlace de pago trae el plan en la metadata y el
            // usuario en client_reference_id. Con eso se da la prueba; customer.subscription.* lo afina.
            const fila = filaDesdeSesionDeEnlace({
              mode: ses.mode, payment_link: typeof ses.payment_link === "string" ? ses.payment_link : (ses.payment_link as any)?.id ?? null,
              metadata: ses.metadata as any, customer: ses.customer ? String(typeof ses.customer === "string" ? ses.customer : (ses.customer as any).id) : null,
              subscription: String(ses.subscription), created: ses.created, amount_total: ses.amount_total,
            });
            const userId = fila ? await findUserId(String(fila.stripe_customer_id), email, ses.client_reference_id) : null;
            if (fila && userId) {
              const { error } = await db.from("user_entitlements").upsert({ user_id: userId, ...fila }, { onConflict: "user_id" });
              if (error) throw new Error(`user_entitlements: ${error.message}`);
              console.log(`derechos (desde el aviso) actualizados: ${userId} → ${fila.tier}/${fila.status}`);
            } else if (fila && email) {
              const { last_payment_error: _e, last_event_at: _t, ...pend } = fila;
              const { error } = await db.from("pending_entitlements").upsert({ email, ...pend, updated_at: new Date().toISOString() }, { onConflict: "email" });
              if (error) throw new Error(`pending_entitlements: ${error.message}`);
            }
            await registrar({ user_id: userId, email, tier: (fila?.tier as string) ?? null, status: (fila?.status as string) ?? null, amount_cents: ses.amount_total ?? null, currency: ses.currency ?? null });
          }
        } else {
          // Pago único (formación 1:1 de 350 €): sólo queda registrado para el equipo.
          const userId = ses.customer ? await findUserId(String(ses.customer), email, ses.client_reference_id) : null;
          await registrar({ user_id: userId, email, tier: null, status: ses.payment_status ?? null, amount_cents: ses.amount_total ?? null, currency: ses.currency ?? null });
        }
        break;
      }
      case "invoice.payment_failed":
      case "invoice.paid": {
        // Se relee la suscripción: el estado que importa es el suyo, no el de la factura.
        const inv = event.data.object as Stripe.Invoice;
        const subId = (inv as any).subscription || (inv as any).parent?.subscription_details?.subscription || null;
        const fallo = event.type === "invoice.payment_failed";
        let paymentError: string | null | undefined = undefined;
        if (fallo) {
          paymentError = "No se pudo cobrar la cuota";
          try {
            const piId = (inv as any).payment_intent || (inv as any).payments?.data?.[0]?.payment?.payment_intent || null;
            if (piId) {
              const pi = await stripe.paymentIntents.retrieve(String(piId));
              paymentError = pi.last_payment_error?.message || paymentError;
            }
          } catch { /* sin detalle del intento */ }
        }
        let r = null;
        if (subId) {
          // Sin clave válida no se puede releer: el estado llega igual por customer.subscription.updated.
          let sub: Stripe.Subscription | null = null;
          try { sub = await stripe.subscriptions.retrieve(String(subId)); }
          catch (e) { console.warn("factura sin releer la suscripción:", (e as any)?.type || "error"); }
          if (sub) r = await applySubscription(sub, { paymentError });
        }
        await registrar({
          user_id: r?.userId ?? null, email: r?.email ?? ((inv.customer_email || "").toLowerCase() || null),
          tier: r?.row.tier ?? null, status: fallo ? "payment_failed" : "paid",
          amount_cents: fallo ? (inv.amount_due ?? null) : (inv.amount_paid ?? null), currency: inv.currency ?? null,
        });
        break;
      }
      default:
        await registrar({});
        break;
    }
  } catch (e) {
    console.error("fallo procesando el evento:", (e as Error).message);
    return new Response("error", { status: 500 }); // 500 para que Stripe reintente
  }

  return json({ received: true });
});
