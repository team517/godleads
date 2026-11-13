// Monedas de Funnyleads (13-11-2026). Sólo sirven para dos cosas, el resto de la plataforma es gratis:
//   · verificar un correo            → 1 moneda
//   · personalizar un lead con IA    → 0,75 monedas (13-11: se paga la lista entera al empezar)
// Precios por debajo de Instantly (≈0,007 €/verificación) y Smartlead (≈0,005 €), pack máximo 99 €.
// Los packs se pagan con enlaces de pago de Stripe (cuenta conectada); el webhook firmado suma las
// monedas (coin_purchases, idempotente por sesión). Nadie suma monedas desde el navegador.

export const COSTE_VERIFICAR = 1;
export const COSTE_PERSONALIZAR = 0.75;

/** Monedas por personalizar `n` leads (redondeado hacia arriba: 1 lead = 1, 4 leads = 3, 100 = 75). */
export function costePersonalizar(n: number): number {
  return Math.max(0, Math.ceil(Math.max(0, n) * COSTE_PERSONALIZAR - 1e-9));
}

/** Lo que se devuelve al terminar: se cobró `cobradas` y sólo salieron bien `ok` leads. */
export function devolucionPersonalizar(cobradas: number, ok: number): number {
  return Math.max(0, cobradas - costePersonalizar(ok));
}

export interface PackMonedas { coins: number; cents: number; linkId: string; url: string }

export const PACKS_MONEDAS: PackMonedas[] = [
  { coins: 1_000, cents: 400, linkId: "plink_1UbIk32ObXNkJIex2YjX4O9c", url: "https://buy.stripe.com/eVq5kwgayclC9OFbMs2ZO0H" },
  { coins: 5_000, cents: 1_500, linkId: "plink_1UbIk52ObXNkJIexGpxKEPYo", url: "https://buy.stripe.com/4gM3coe2qetKf8ZaIo2ZO0I" },
  { coins: 10_000, cents: 2_500, linkId: "plink_1UbIk72ObXNkJIexM0SVWYqz", url: "https://buy.stripe.com/5kQcMY3nM5Xegd32bS2ZO0J" },
  { coins: 25_000, cents: 5_500, linkId: "plink_1UbIk82ObXNkJIexI9fNzehk", url: "https://buy.stripe.com/3cI28k1fE1GY7Gx6s82ZO0K" },
  { coins: 50_000, cents: 9_900, linkId: "plink_1UbIkA2ObXNkJIexUqoILRU1", url: "https://buy.stripe.com/bJe3co7E271igd317O2ZO0L" },
];

/** Cuentas con monedas ilimitadas (el equipo y cuentas especiales), por su correo de ACCESO. */
export const MONEDAS_INFINITAS = [
  "hello@onepulso.blog", "support@onepulso.online", "equipo@onepulso.online",
  "oliver@llueert.com", "oliver@pannggostudioo.com", "alex@lluert.net", "rk@coldabry.com",
  "oliver@osakaadigital.com", "eric@dekano-core.es", "alex@vioonyx.com",
];

export interface SesionCompra {
  mode?: string | null;
  payment_status?: string | null;
  payment_link?: string | null;
  metadata?: Record<string, string> | null;
  amount_total?: number | null;
}

/** Monedas que da un checkout completado y cobrado (0 si no es una compra de monedas). Puro.
 *  Manda el enlace de pago; la metadata sólo sirve si además cuadra el importe con un pack. */
export function monedasDeSesion(s: SesionCompra | null | undefined): number {
  if (!s || s.mode !== "payment" || s.payment_status !== "paid") return 0;
  const porEnlace = PACKS_MONEDAS.find((p) => p.linkId === s.payment_link);
  if (porEnlace) return porEnlace.coins;
  if (s.metadata?.kind === "coins") {
    const n = Number(s.metadata.coins);
    const pack = PACKS_MONEDAS.find((p) => p.coins === n && p.cents === s.amount_total);
    if (pack) return pack.coins;
  }
  return 0;
}

/** Quién paga las monedas de una acción. Puro: los datos los trae el llamador.
 *  · equipo / cuentas especiales / clientes gestionados por la agencia (allowed_routes) → gratis
 *  · acceso de un cliente de un usuario (client_login_of) → paga la agencia dueña del cliente
 *  · el resto → paga él mismo */
export function quienPaga(i: {
  userId: string; email: string | null;
  role?: string | null; isClientManager?: boolean | null;
  allowedRoutes?: string[] | null; agenciaDelCliente?: string | null;
}): { gratis: true } | { gratis: false; payer: string } {
  const email = String(i.email || "").trim().toLowerCase();
  if (MONEDAS_INFINITAS.includes(email) || i.role === "admin" || i.isClientManager) return { gratis: true };
  if (i.allowedRoutes && i.allowedRoutes.length > 0) return { gratis: true };
  if (i.agenciaDelCliente) return { gratis: false, payer: i.agenciaDelCliente };
  return { gratis: false, payer: i.userId };
}

/* ── Con la base de datos (service role) ───────────────────────────────────────────────────── */

export type Cobro = { ok: true; gratis: boolean; restantes: number | null } | { ok: false; required: number; available: number };

/** Cobra `cantidad` monedas por una acción de `userId` (o a su agencia). Atómico en la base de datos:
 *  nunca deja el saldo en negativo aunque haya dos peticiones a la vez. */
// deno-lint-ignore no-explicit-any
export async function cobrarMonedas(db: any, userId: string, email: string | null, cantidad: number): Promise<Cobro> {
  const n = Math.max(0, Math.ceil(cantidad));
  if (n === 0) return { ok: true, gratis: false, restantes: null };
  const [{ data: perfil }, { data: rol }] = await Promise.all([
    db.from("profiles").select("allowed_routes, is_client_manager, client_login_of").eq("user_id", userId).maybeSingle(),
    db.from("user_roles").select("role").eq("user_id", userId).maybeSingle(),
  ]);
  let agencia: string | null = null;
  if (perfil?.client_login_of) {
    const { data: c } = await db.from("clients").select("owner_user_id").eq("id", perfil.client_login_of).maybeSingle();
    agencia = c?.owner_user_id ?? null;
  }
  const q = quienPaga({ userId, email, role: rol?.role ?? null, isClientManager: perfil?.is_client_manager ?? false, allowedRoutes: perfil?.allowed_routes ?? null, agenciaDelCliente: agencia });
  if (q.gratis) return { ok: true, gratis: true, restantes: null };
  const { data, error } = await db.rpc("spend_coins", { p_user: q.payer, p_amount: n });
  if (error) throw new Error(`spend_coins: ${error.message}`);
  if (data === null || data === undefined) {
    const { data: p } = await db.from("profiles").select("coins").eq("user_id", q.payer).maybeSingle();
    return { ok: false, required: n, available: Number(p?.coins ?? 0) };
  }
  return { ok: true, gratis: false, restantes: Number(data) };
}

/** Devuelve monedas cobradas que no se usaron (p. ej. leads ya verificados o fallos). */
// deno-lint-ignore no-explicit-any
export async function devolverMonedas(db: any, userId: string, email: string | null, cantidad: number): Promise<void> {
  const n = Math.max(0, Math.floor(cantidad));
  if (n === 0) return;
  const [{ data: perfil }, { data: rol }] = await Promise.all([
    db.from("profiles").select("allowed_routes, is_client_manager, client_login_of").eq("user_id", userId).maybeSingle(),
    db.from("user_roles").select("role").eq("user_id", userId).maybeSingle(),
  ]);
  let agencia: string | null = null;
  if (perfil?.client_login_of) {
    const { data: c } = await db.from("clients").select("owner_user_id").eq("id", perfil.client_login_of).maybeSingle();
    agencia = c?.owner_user_id ?? null;
  }
  const q = quienPaga({ userId, email, role: rol?.role ?? null, isClientManager: perfil?.is_client_manager ?? false, allowedRoutes: perfil?.allowed_routes ?? null, agenciaDelCliente: agencia });
  if (q.gratis) return;
  await db.rpc("refund_coins", { p_user: q.payer, p_amount: n });
}
