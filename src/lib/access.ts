// Pure access/trial decision — who gets free unlimited access vs. the 14-day trial → pay. Extracted
// from SubscriptionContext so the billing rules can be unit-tested (this gates real access, so it
// must be exactly right and never lock out staff / clients / existing users).
//
// Owner's rule: accounts created by the agency (hello@ / support@ / equipo@) — the client accounts
// they create (which carry allowed_routes), plus the agency accounts themselves — are FREE and
// unlimited. Every account that already existed before the paywall went live is grandfathered.
// Only genuinely NEW self-signups face the trial and then must pay.
//
// 10-11-2026 (Funnyleads): the server row `user_entitlements` (written by the Stripe webhook and
// check-subscription) is the truth of the plan. From it: active/trialing → subscribed; past_due /
// unpaid / incomplete → "payment_failed" (blocked: "no hemos podido cobrar"); canceled or an expired
// period → "canceled" (blocked: "tu suscripción ha terminado"); no row → the platform's 14-day trial.

export const ADMIN_EMAILS = ["hello@onepulso.blog", "support@onepulso.online", "equipo@onepulso.online"];
// Free + unlimited access, but NOT admin (no admin panel — that's role="admin", separate). Matched
// against the LOGIN email only.
export const SPECIAL_FULL_ACCESS_EMAILS = ["oliver@llueert.com", "oliver@pannggostudioo.com", "alex@lluert.net", "rk@coldabry.com", "oliver@osakaadigital.com", "eric@dekano-core.es", "oliver@clackstudio-creative.com", "alex@vioonyx.com", "oliver@tiarecrew.com", "csnovacompany@gmail.com"];
/** Prueba gratuita de la plataforma para registros nuevos sin pago (la landing dice 14 días). */
export const TRIAL_DAYS = 14;
// Accounts created BEFORE this stay free (grandfathered). Only NEW self-signups from here on trial.
export const TRIAL_CUTOFF_MS = Date.parse("2026-08-29T00:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;
/** Margen tras el fin del periodo/prueba antes de dar la suscripción por vencida (Stripe renueva
 *  y el webhook avisa; un retraso de horas no debe bloquear a nadie). */
const GRACE_MS = DAY_MS;

export type PlanTierServer = "free" | "starter" | "growth" | "scale";

/** Lo que hay en user_entitlements para el usuario (null = sin fila). */
export interface EntitlementInput {
  status: string | null;             // active | trialing | past_due | unpaid | incomplete | incomplete_expired | canceled | paused | inactive
  tier: string | null;
  trialEnd: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd?: boolean | null;
  lastPaymentError?: string | null;
}

export type AccessDecision =
  | { kind: "staff" }                                                      // agency/admin/manager/special → full access
  | { kind: "free" }                                                       // admin-created client or grandfathered → free unlimited
  | { kind: "subscribed"; tier: PlanTierServer; status: "active" | "trialing"; trialEnd: string | null; periodEnd: string | null; cancelAtPeriodEnd: boolean }
  | { kind: "payment_failed"; tier: PlanTierServer; status: string; lastPaymentError: string | null; periodEnd: string | null }
  | { kind: "canceled"; tier: PlanTierServer; status: string; periodEnd: string | null }
  | { kind: "trialing"; trialEnd: string; daysLeft: number }               // new signup, inside the free days
  | { kind: "expired"; trialEnd: string }                                  // new signup, trial over → must pay (BLOCKED)
  | { kind: "trial_unknown" };                                             // no creation date → fail-safe, never blocked

export interface AccessInput {
  email: string | null;
  role: string | null;                 // user_roles.role
  isClientManager: boolean;
  allowedRoutes: string[] | null | undefined;
  contactEmail: string | null;
  createdAt: string | null;            // account creation (immutable, set by auth)
  /** Compatibilidad: "Stripe dice que está suscrito" sin más detalle → subscribed. */
  stripeSubscribed: boolean;
  /** La fila de user_entitlements (la verdad del servidor). */
  entitlement?: EntitlementInput | null;
  nowMs?: number;                      // injectable for tests
}

/** Cuenta de la AGENCIA (OnePulso): el propietario, support@ y equipo@, más
 *  cualquier gestor de clientes. Son las que tienen su propio "Portal de Clientes"
 *  (/admin/clients), así que NO deben ver la sección "Clientes" para usuarios
 *  finales. Una sola definición para que el menú y el guardado de ruta coincidan. */
export function isAgencyAccount(email: string | null, isClientManager: boolean): boolean {
  const e = (email || "").toLowerCase();
  return !!isClientManager || ADMIN_EMAILS.includes(e);
}

const TIERS: PlanTierServer[] = ["free", "starter", "growth", "scale"];
const tierOf = (t: string | null | undefined): PlanTierServer => (TIERS.includes((t || "").toLowerCase() as PlanTierServer) ? (t as string).toLowerCase() as PlanTierServer : "free");
const ms = (iso: string | null | undefined): number => (iso ? Date.parse(iso) : NaN);

export const PAYMENT_FAILED_STATUSES = ["past_due", "unpaid", "incomplete", "incomplete_expired"];
export const CANCELED_STATUSES = ["canceled", "paused"];

/** Decisión a partir de la fila del servidor, o null si la fila no dice nada (sin fila, inactive, free). */
export function decideFromEntitlement(e: EntitlementInput | null | undefined, now: number): AccessDecision | null {
  if (!e || !e.status) return null;
  const status = e.status.toLowerCase();
  const tier = tierOf(e.tier);
  const periodEnd = e.currentPeriodEnd ?? null;
  if (status === "active" || status === "trialing") {
    // Fin de periodo (o de prueba) vencido con margen → la renovación no llegó: se trata como baja.
    const limite = status === "trialing" ? (ms(e.trialEnd) || ms(periodEnd)) : ms(periodEnd);
    if (!Number.isNaN(limite) && now > limite + GRACE_MS) {
      return { kind: "canceled", tier, status: "expired", periodEnd };
    }
    return { kind: "subscribed", tier: tier === "free" ? "starter" : tier, status, trialEnd: e.trialEnd ?? null, periodEnd, cancelAtPeriodEnd: !!e.cancelAtPeriodEnd };
  }
  if (PAYMENT_FAILED_STATUSES.includes(status)) {
    return { kind: "payment_failed", tier, status, lastPaymentError: e.lastPaymentError ?? null, periodEnd };
  }
  if (CANCELED_STATUSES.includes(status)) {
    return { kind: "canceled", tier, status, periodEnd };
  }
  return null; // inactive / free / desconocido → la prueba de la plataforma decide
}

export function decideAccess(i: AccessInput): AccessDecision {
  const email = (i.email || "").toLowerCase();
  // Staff / free-access → always full access, never gated. Matched ONLY on the immutable LOGIN
  // email — NOT contact_email, which the user edits freely in Settings.
  if (i.role === "admin" || ADMIN_EMAILS.includes(email) || i.isClientManager
      || SPECIAL_FULL_ACCESS_EMAILS.includes(email)) {
    return { kind: "staff" };
  }
  const hasRoutes = !!(i.allowedRoutes && i.allowedRoutes.length > 0);
  const createdMs = i.createdAt ? Date.parse(i.createdAt) : NaN;
  const grandfathered = Number.isNaN(createdMs) ? true : createdMs < TRIAL_CUTOFF_MS;
  // Admin-created client OR pre-existing account → free + unlimited.
  if (hasRoutes || grandfathered) return { kind: "free" };

  const now = i.nowMs ?? Date.now();
  // New self-signup: what the server knows about the subscription wins.
  const porServidor = decideFromEntitlement(i.entitlement, now);
  if (porServidor) return porServidor;
  if (i.stripeSubscribed) return { kind: "subscribed", tier: tierOf(i.entitlement?.tier) === "free" ? "starter" : tierOf(i.entitlement?.tier), status: "active", trialEnd: null, periodEnd: null, cancelAtPeriodEnd: false };
  // Else the free trial from signup.
  if (Number.isNaN(createdMs)) return { kind: "trial_unknown" };
  const endMs = createdMs + TRIAL_DAYS * DAY_MS;
  if (now < endMs) {
    return { kind: "trialing", trialEnd: new Date(endMs).toISOString(), daysLeft: Math.max(0, Math.ceil((endMs - now) / DAY_MS)) };
  }
  return { kind: "expired", trialEnd: new Date(endMs).toISOString() };
}
