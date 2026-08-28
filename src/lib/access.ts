// Pure access/trial decision — who gets free unlimited access vs. the 5-day trial → pay. Extracted
// from SubscriptionContext so the billing rules can be unit-tested (this gates real access, so it
// must be exactly right and never lock out staff / clients / existing users).
//
// Owner's rule: accounts created by the agency (hello@ / support@ / equipo@) — the client accounts
// they create (which carry allowed_routes), plus the agency accounts themselves — are FREE and
// unlimited. Every account that already existed before the paywall went live is grandfathered.
// Only genuinely NEW self-signups face the 5-day trial and then must pay.

export const ADMIN_EMAILS = ["hello@onepulso.blog", "support@onepulso.online", "equipo@onepulso.online"];
// Free + unlimited access, but NOT admin (no admin panel — that's role="admin", separate). Matched
// against the LOGIN email OR the profile contact_email.
export const SPECIAL_FULL_ACCESS_EMAILS = ["oliver@llueert.com", "oliver@pannggostudioo.com", "alex@lluert.net", "rk@coldabry.com", "oliver@osakaadigital.com", "eric@dekano-core.es", "oliver@clackstudio-creative.com", "alex@vioonyx.com", "oliver@tiarecrew.com", "csnovacompany@gmail.com"];
export const TRIAL_DAYS = 5;
// Accounts created BEFORE this stay free (grandfathered). Only NEW self-signups from here on trial.
export const TRIAL_CUTOFF_MS = Date.parse("2026-08-29T00:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;

export type AccessDecision =
  | { kind: "staff" }                                          // agency/admin/manager/special → full access
  | { kind: "free" }                                           // admin-created client or grandfathered → free unlimited
  | { kind: "subscribed" }                                     // paying customer
  | { kind: "trialing"; trialEnd: string; daysLeft: number }   // new signup, inside the 5 days
  | { kind: "expired"; trialEnd: string }                      // new signup, trial over → must pay (BLOCKED)
  | { kind: "trial_unknown" };                                 // no creation date → fail-safe, never blocked

export interface AccessInput {
  email: string | null;
  role: string | null;                 // user_roles.role
  isClientManager: boolean;
  allowedRoutes: string[] | null | undefined;
  contactEmail: string | null;
  createdAt: string | null;            // account creation (immutable, set by auth)
  stripeSubscribed: boolean;
  nowMs?: number;                      // injectable for tests
}

export function decideAccess(i: AccessInput): AccessDecision {
  const email = (i.email || "").toLowerCase();
  const contact = (i.contactEmail || "").toLowerCase();
  // Staff / free-access → always full access, never gated. Free-access emails (SPECIAL_*) get
  // unlimited access but NO admin panel; matched on the login email OR the contact_email.
  if (i.role === "admin" || ADMIN_EMAILS.includes(email) || i.isClientManager
      || SPECIAL_FULL_ACCESS_EMAILS.includes(email) || (!!contact && SPECIAL_FULL_ACCESS_EMAILS.includes(contact))) {
    return { kind: "staff" };
  }
  const hasRoutes = !!(i.allowedRoutes && i.allowedRoutes.length > 0);
  const createdMs = i.createdAt ? Date.parse(i.createdAt) : NaN;
  const grandfathered = Number.isNaN(createdMs) ? true : createdMs < TRIAL_CUTOFF_MS;
  // Admin-created client OR pre-existing account → free + unlimited.
  if (hasRoutes || grandfathered) return { kind: "free" };
  // New self-signup: paying → subscribed; else the 5-day trial from signup.
  if (i.stripeSubscribed) return { kind: "subscribed" };
  if (Number.isNaN(createdMs)) return { kind: "trial_unknown" };
  const now = i.nowMs ?? Date.now();
  const endMs = createdMs + TRIAL_DAYS * DAY_MS;
  if (now < endMs) {
    return { kind: "trialing", trialEnd: new Date(endMs).toISOString(), daysLeft: Math.max(0, Math.ceil((endMs - now) / DAY_MS)) };
  }
  return { kind: "expired", trialEnd: new Date(endMs).toISOString() };
}
