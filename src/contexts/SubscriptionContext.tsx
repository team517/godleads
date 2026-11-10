import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { decideAccess, type AccessDecision, type EntitlementInput } from "@/lib/access";
import { PROFILE_BOOT_COLS, profileQueryKey, roleQueryKey, sharedQuery } from "@/lib/boot-queries";

export type PlanTier = "free" | "starter" | "growth" | "scale";

/** Planes de Funnyleads (10-11-2026): los mismos precios y price ids que los enlaces de pago de la
 *  landing (EUR; el anual se cobra entero). create-checkout sólo acepta estos price ids. */
export const PLAN_CONFIG = {
  starter: {
    label: "Starter",
    maxLeads: 5000,
    // Correos al mes: es el metro con el que se vende. El motor topa cada buzón en 15 al día.
    emailsPerMonth: 15000,
    maxAccounts: Infinity,
    // Clientes que puede crear el usuario dentro de su cuenta (sección Clientes). Misma cifra que
    // aplica el servidor en public.client_slots_for; aquí sólo sirve para que los precios digan la verdad.
    maxClients: 0,
    monthly: { priceId: "price_1UaCJz2ObXNkJIexLnC0KEao", price: 21 },
    annual: { priceId: "price_1UaCK82ObXNkJIex9sAU4ko7", price: 204, perMonth: 17 },
    productIds: ["prod_VbP8mquDtmuTKr", "prod_U29mvQRMbo5m6f", "prod_U29mwf36xp5tzO"],
  },
  growth: {
    label: "Growth",
    maxLeads: 60000,
    emailsPerMonth: 180000,
    maxAccounts: Infinity,
    maxClients: 5,
    monthly: { priceId: "price_1UaCK42ObXNkJIexveYDJQRh", price: 65 },
    annual: { priceId: "price_1UaCKB2ObXNkJIexITFdvpKA", price: 648, perMonth: 54 },
    productIds: ["prod_VbP8T2qoDDeJOO", "prod_U29mEi2w9ltRwG", "prod_U29nlSXrrxJsWI"],
  },
  scale: {
    label: "Scale",
    maxLeads: Infinity,
    emailsPerMonth: 500000,
    maxAccounts: Infinity,
    maxClients: 10,
    monthly: { priceId: "price_1UaCK62ObXNkJIexngKtK5Br", price: 170 },
    annual: { priceId: "price_1UaCKD2ObXNkJIexO8o0rU1L", price: 1692, perMonth: 141 },
    productIds: ["prod_VbP8hN9R1brqFJ", "prod_U29nsLzCYygn4u", "prod_U29n2lYSL63LWg"],
  },
} as const;

/** Línea de "correos al mes" para las tarjetas de precio. Sale de PLAN_CONFIG, la misma fuente que cobra Stripe. */
export function emailsFeature(tier: Exclude<PlanTier, "free">): string {
  return `${PLAN_CONFIG[tier].emailsPerMonth.toLocaleString("es-ES")} correos al mes`;
}

/** Línea de "clientes incluidos" para las tarjetas de precio. */
export function clientsFeature(tier: Exclude<PlanTier, "free">): string {
  const n = PLAN_CONFIG[tier].maxClients;
  return n === 0 ? "Sin gestión de clientes" : `${n} clientes`;
}

export const FREE_LIMITS = { maxLeads: Infinity, maxAccounts: Infinity, emailsPerMonth: Infinity, maxClients: 0 };
export const TRIAL_LIMITS = { maxLeads: Infinity, maxAccounts: Infinity, emailsPerMonth: Infinity, maxClients: 0 };

function getTierFromProductId(productId: string | null): PlanTier {
  if (!productId) return "free";
  for (const [tier, config] of Object.entries(PLAN_CONFIG)) {
    if ((config.productIds as readonly string[]).includes(productId)) return tier as PlanTier;
  }
  return "free";
}

export function getPlanLimits(tier: PlanTier, _isTrialing: boolean) {
  if (tier === "free") return FREE_LIMITS;
  return {
    maxLeads: PLAN_CONFIG[tier].maxLeads,
    maxAccounts: PLAN_CONFIG[tier].maxAccounts,
    emailsPerMonth: PLAN_CONFIG[tier].emailsPerMonth,
    maxClients: PLAN_CONFIG[tier].maxClients,
  };
}

/** Estado de la suscripción tal y como lo ve la app (resumen de la decisión). */
export type SubscriptionStatus =
  | "staff" | "free"
  | "active" | "trialing"          // suscripción de Stripe con acceso (trialing = sus 14 días de prueba)
  | "platform_trial"               // prueba gratuita de la plataforma, sin pago
  | "expired"                      // prueba terminada sin pagar
  | "needs_card"                   // alta desde el 11-11-2026 sin prueba con tarjeta: "Activa tu prueba gratuita"
  | "payment_failed" | "canceled"; // problema de cobro / suscripción terminada

interface SubscriptionContextType {
  tier: PlanTier;
  subscribed: boolean;
  subscriptionEnd: string | null;
  loading: boolean;
  limits: { maxLeads: number; maxAccounts: number };
  isTrialing: boolean;
  trialEnd: string | null;
  trialExpired: boolean;
  trialDaysLeft: number | null;
  /** user_roles.role, read ONCE at boot. null = no row. */
  role: string | null;
  isAdmin: boolean;
  /** Resumen del estado (10-11-2026). */
  status: SubscriptionStatus;
  /** La fila de user_entitlements tal cual (null = sin fila). */
  entitlement: EntitlementInput | null;
  periodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  /** Impago o suscripción terminada: la app enseña la pantalla de bloqueo. */
  paymentProblem: null | { kind: "payment_failed" | "canceled"; tier: PlanTier; lastPaymentError: string | null; periodEnd: string | null };
  /** Esta cuenta paga (registro propio nuevo): es a quien se le enseñan planes y botones de pago. */
  billable: boolean;
  /** Registro desde el corte sin prueba con tarjeta ni plan: la app enseña "Activa tu prueba gratuita". */
  needsCard: boolean;
  refreshSubscription: () => Promise<void>;
}

const SubscriptionContext = createContext<SubscriptionContextType | undefined>(undefined);

const ENTITLEMENT_COLS = "status, tier, trial_end, current_period_end, cancel_at_period_end, last_payment_error, updated_at, last_event_at";
/** Una fila más vieja que esto se vuelve a comprobar en Stripe en segundo plano. */
const ENTITLEMENT_STALE_MS = 6 * 60 * 60 * 1000;

function toEntitlement(row: any): EntitlementInput | null {
  if (!row) return null;
  return {
    status: row.status ?? null,
    tier: row.tier ?? null,
    trialEnd: row.trial_end ?? null,
    currentPeriodEnd: row.current_period_end ?? null,
    cancelAtPeriodEnd: !!row.cancel_at_period_end,
    lastPaymentError: row.last_payment_error ?? null,
  };
}

export function SubscriptionProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [tier, setTier] = useState<PlanTier>("free");
  const [subscribed, setSubscribed] = useState(false);
  const [subscriptionEnd, setSubscriptionEnd] = useState<string | null>(null);
  const [isTrialing, setIsTrialing] = useState(false);
  const [trialEnd, setTrialEnd] = useState<string | null>(null);
  const [trialDaysLeft, setTrialDaysLeft] = useState<number | null>(null);
  const [trialExpired, setTrialExpired] = useState(false);
  const [role, setRole] = useState<string | null>(null);
  const [status, setStatus] = useState<SubscriptionStatus>("free");
  const [entitlement, setEntitlement] = useState<EntitlementInput | null>(null);
  const [periodEnd, setPeriodEnd] = useState<string | null>(null);
  const [cancelAtPeriodEnd, setCancelAtPeriodEnd] = useState(false);
  const [paymentProblem, setPaymentProblem] = useState<SubscriptionContextType["paymentProblem"]>(null);
  const [billable, setBillable] = useState(false);
  const [needsCard, setNeedsCard] = useState(false);
  const [loading, setLoading] = useState(true);

  const resetSubscriptionState = useCallback(() => {
    setTier("free"); setSubscribed(false); setSubscriptionEnd(null);
    setIsTrialing(false); setTrialEnd(null); setTrialDaysLeft(null); setTrialExpired(false);
    setRole(null); setStatus("free"); setEntitlement(null); setPeriodEnd(null);
    setCancelAtPeriodEnd(false); setPaymentProblem(null); setBillable(false); setNeedsCard(false);
  }, []);

  const applyDecision = useCallback((decision: AccessDecision, ent: EntitlementInput | null) => {
    setEntitlement(ent);
    setPaymentProblem(null);
    setCancelAtPeriodEnd(false);
    setPeriodEnd(null);
    setBillable(!(decision.kind === "staff" || decision.kind === "free"));
    setNeedsCard(decision.kind === "needs_card");
    switch (decision.kind) {
      case "needs_card":
        setSubscribed(false); setSubscriptionEnd(null); setTier("free");
        setIsTrialing(false); setTrialEnd(null); setTrialDaysLeft(null); setTrialExpired(false);
        setStatus("needs_card");
        break;
      case "staff":
        setSubscribed(true); setSubscriptionEnd(null); setTier("scale");
        setIsTrialing(false); setTrialEnd(null); setTrialDaysLeft(null); setTrialExpired(false);
        setStatus("staff");
        break;
      case "free":
      case "trial_unknown":
        setSubscribed(false); setSubscriptionEnd(null); setTier("free");
        setIsTrialing(false); setTrialEnd(null); setTrialDaysLeft(null); setTrialExpired(false);
        setStatus("free");
        break;
      case "subscribed": {
        setSubscribed(true); setSubscriptionEnd(decision.periodEnd); setTier(decision.tier === "free" ? "starter" : decision.tier);
        setPeriodEnd(decision.periodEnd); setCancelAtPeriodEnd(decision.cancelAtPeriodEnd);
        // Prueba de 14 días de Stripe: se enseña como prueba (con sus días), pero con acceso de pago.
        const enPrueba = decision.status === "trialing";
        const diasPrueba = enPrueba && decision.trialEnd ? Math.max(0, Math.ceil((Date.parse(decision.trialEnd) - Date.now()) / 86_400_000)) : null;
        setIsTrialing(enPrueba); setTrialEnd(enPrueba ? decision.trialEnd : null); setTrialDaysLeft(diasPrueba); setTrialExpired(false);
        setStatus(enPrueba ? "trialing" : "active");
        break;
      }
      case "payment_failed":
      case "canceled":
        setSubscribed(false); setSubscriptionEnd(decision.periodEnd); setTier(decision.tier);
        setIsTrialing(false); setTrialEnd(null); setTrialDaysLeft(null); setTrialExpired(false);
        setPeriodEnd(decision.periodEnd);
        setPaymentProblem({ kind: decision.kind, tier: decision.tier, lastPaymentError: decision.kind === "payment_failed" ? decision.lastPaymentError : null, periodEnd: decision.periodEnd });
        setStatus(decision.kind);
        break;
      case "trialing":
        setSubscribed(false); setSubscriptionEnd(null); setTier("free");
        setIsTrialing(true); setTrialEnd(decision.trialEnd); setTrialDaysLeft(decision.daysLeft); setTrialExpired(false);
        setStatus("platform_trial");
        break;
      case "expired":
        setSubscribed(false); setSubscriptionEnd(null); setTier("free");
        setIsTrialing(false); setTrialEnd(decision.trialEnd); setTrialDaysLeft(0); setTrialExpired(true);
        setStatus("expired");
        break;
    }
  }, []);

  const refreshSubscription = useCallback(async () => {
    setLoading(true);

    if (!user) {
      resetSubscriptionState();
      setLoading(false);
      return;
    }

    try {
      // Tres lecturas EN PARALELO, compartidas con los demás lectores del arranque (boot-queries.ts).
      // La fila de user_entitlements la escribe el servidor (webhook de Stripe / check-subscription);
      // RLS sólo deja leer la propia.
      const [{ data: roleData }, { data: profileCheck }, entRes] = await Promise.all([
        sharedQuery(roleQueryKey(user.id), () =>
          supabase.from("user_roles").select("role").eq("user_id", user.id).single()),
        sharedQuery<{ data: any; error: any }>(profileQueryKey(user.id), () =>
          (supabase as any).from("profiles").select(PROFILE_BOOT_COLS).eq("user_id", user.id).single()),
        (supabase as any).from("user_entitlements").select(ENTITLEMENT_COLS).eq("user_id", user.id).maybeSingle(),
      ]);
      setRole((roleData as any)?.role ?? null);
      const entRow = (entRes as any)?.data ?? null;
      const ent = toEntitlement(entRow);

      const baseInput = {
        email: user.email || null,
        role: (roleData as any)?.role ?? null,
        isClientManager: !!(profileCheck as any)?.is_client_manager,
        allowedRoutes: (profileCheck as any)?.allowed_routes ?? null,
        contactEmail: (profileCheck as any)?.contact_email ?? null,
        // Immutable account creation time → the trial can't be reset/gamed.
        createdAt: (user as any)?.created_at || (profileCheck as any)?.created_at || null,
        stripeSubscribed: false,
        entitlement: ent,
      };

      // Se decide YA con lo que hay (staff / free / fila del servidor / prueba de la plataforma).
      let decision = decideAccess(baseInput);
      applyDecision(decision, ent);

      // Registro propio nuevo: si la fila falta o está vieja, se pregunta a Stripe en segundo plano y
      // se vuelve a decidir. Un fallo de esa llamada NUNCA empeora la decisión ya tomada.
      if (decision.kind !== "staff" && decision.kind !== "free") {
        const freshAt = entRow ? Date.parse(entRow.last_event_at || entRow.updated_at || "") : NaN;
        const stale = Number.isNaN(freshAt) || Date.now() - freshAt > ENTITLEMENT_STALE_MS;
        if (stale) {
          setLoading(false); // la app no espera a Stripe
          const { data, error } = await supabase.functions.invoke("check-subscription");
          if (error) { console.error("Sub check error:", error); return; }
          if (data && !data.error && !data.unconfigured) {
            const ent2: EntitlementInput = {
              status: data.status ?? (data.subscribed ? "active" : "inactive"),
              tier: data.tier ?? null,
              trialEnd: data.trial_end ?? null,
              currentPeriodEnd: data.current_period_end ?? data.subscription_end ?? null,
              cancelAtPeriodEnd: !!data.cancel_at_period_end,
              lastPaymentError: ent?.lastPaymentError ?? null,
            };
            decision = decideAccess({ ...baseInput, entitlement: ent2, stripeSubscribed: !!data.subscribed });
            applyDecision(decision, ent2);
          }
        }
      }
    } catch (e) {
      console.error("Sub check failed:", e);
      resetSubscriptionState();
    } finally {
      setLoading(false);
    }
  }, [user, resetSubscriptionState, applyDecision]);

  // Reset state immediately when user changes, then fetch fresh data
  useEffect(() => {
    resetSubscriptionState();
    setLoading(true);
    refreshSubscription();
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const limits = getPlanLimits(tier, isTrialing);

  return (
    <SubscriptionContext.Provider value={{
      tier, subscribed, subscriptionEnd, loading, limits, isTrialing, trialEnd, trialExpired, trialDaysLeft,
      role, isAdmin: role === "admin", status, entitlement, periodEnd, cancelAtPeriodEnd, paymentProblem, billable,
      needsCard, refreshSubscription,
    }}>
      {children}
    </SubscriptionContext.Provider>
  );
}

export function useSubscription() {
  const ctx = useContext(SubscriptionContext);
  if (!ctx) throw new Error("useSubscription must be used within SubscriptionProvider");
  return ctx;
}

// getTierFromProductId se conserva para quien lo importe.
export { getTierFromProductId };
