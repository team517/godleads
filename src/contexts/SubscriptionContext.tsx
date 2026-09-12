import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { decideAccess } from "@/lib/access";

export type PlanTier = "free" | "starter" | "growth" | "scale";

export const PLAN_CONFIG = {
  starter: {
    label: "Starter",
    maxLeads: 1000,
    // Correos al mes: es el metro con el que se vende (como Smartlead). El motor
    // topa cada buzón en 30 al día, así que los buzones incluidos salen de la
    // cifra mensual: 6.000 / 30 días = 200 al día = 7 buzones. Se dan 10.
    emailsPerMonth: 6000,
    maxAccounts: 10,
    // Clientes que puede crear el usuario dentro de su cuenta (sección Clientes).
    // Es la MISMA cifra que aplica el servidor en public.client_slots_for; aquí
    // solo sirve para que los precios digan la verdad — el tope no se decide aquí.
    maxClients: 0,
    monthly: { priceId: "price_1T45Sb2ObXNkJIexkE6GEzxU", price: 29 },
    annual: { priceId: "price_1T45Sw2ObXNkJIexJrrQjQJ5", price: 290 },
    productIds: ["prod_U29mvQRMbo5m6f", "prod_U29mwf36xp5tzO"],
  },
  growth: {
    label: "Growth",
    maxLeads: 100000,
    // 180.000 al mes = 6.000 al día. A 30 por buzón hacen falta 200 buzones:
    // los 15 de antes solo podían mandar unos 13.500 al mes, trece veces menos
    // que lo que promete el plan.
    emailsPerMonth: 180000,
    maxAccounts: 200,
    maxClients: 5,
    monthly: { priceId: "price_1T45T82ObXNkJIexHb0OjLpo", price: 79 },
    annual: { priceId: "price_1T45TQ2ObXNkJIexO5rlaZOv", price: 790 },
    productIds: ["prod_U29mEi2w9ltRwG", "prod_U29nlSXrrxJsWI"],
  },
  scale: {
    label: "Scale",
    maxLeads: Infinity,
    emailsPerMonth: 500000,   // 500.000 al mes ≈ 16.700 al día
    maxAccounts: Infinity,
    maxClients: 10,
    monthly: { priceId: "price_1T45Tb2ObXNkJIex9ZwHkVt8", price: 199 },
    annual: { priceId: "price_1T45Tn2ObXNkJIexpae7rzAg", price: 1990 },
    productIds: ["prod_U29nsLzCYygn4u", "prod_U29n2lYSL63LWg"],
  },
} as const;

/** Línea de "correos al mes" para las tarjetas de precio. Sale de PLAN_CONFIG,
 *  la misma fuente que cobra Stripe. */
export function emailsFeature(tier: Exclude<PlanTier, "free">): string {
  return `${PLAN_CONFIG[tier].emailsPerMonth.toLocaleString("es-ES")} correos al mes`;
}

/** Línea de "clientes incluidos" para las tarjetas de precio. Sale de PLAN_CONFIG
 *  para que la interfaz no pueda contradecir al plan. */
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
  refreshSubscription: () => Promise<void>;
}

const SubscriptionContext = createContext<SubscriptionContextType | undefined>(undefined);

export function SubscriptionProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [tier, setTier] = useState<PlanTier>("free");
  const [subscribed, setSubscribed] = useState(false);
  const [subscriptionEnd, setSubscriptionEnd] = useState<string | null>(null);
  const [isTrialing, setIsTrialing] = useState(false);
  const [trialEnd, setTrialEnd] = useState<string | null>(null);
  const [trialDaysLeft, setTrialDaysLeft] = useState<number | null>(null);
  const [trialExpired, setTrialExpired] = useState(false);
  const [loading, setLoading] = useState(true);

  const resetSubscriptionState = useCallback(() => {
    setTier("free");
    setSubscribed(false);
    setSubscriptionEnd(null);
    setIsTrialing(false);
    setTrialEnd(null);
    setTrialDaysLeft(null);
    setTrialExpired(false);
  }, []);

  const refreshSubscription = useCallback(async () => {
    setLoading(true);

    if (!user) {
      resetSubscriptionState();
      setLoading(false);
      return;
    }

    try {
      const { data: roleData } = await supabase
        .from("user_roles").select("role").eq("user_id", user.id).single();
      const { data: profileCheck } = await supabase
        .from("profiles").select("allowed_routes, contact_email, is_client_manager, created_at")
        .eq("user_id", user.id).single();

      const baseInput = {
        email: user.email || null,
        role: (roleData as any)?.role ?? null,
        isClientManager: !!(profileCheck as any)?.is_client_manager,
        allowedRoutes: (profileCheck as any)?.allowed_routes ?? null,
        contactEmail: (profileCheck as any)?.contact_email ?? null,
        // Immutable account creation time → the trial can't be reset/gamed.
        createdAt: (user as any)?.created_at || (profileCheck as any)?.created_at || null,
        stripeSubscribed: false,
      };

      // Decide WITHOUT Stripe first — staff / admin-created / grandfathered accounts never need a
      // Stripe call. Only a genuine NEW self-signup falls through to the paid/trial branch.
      let decision = decideAccess(baseInput);
      let stripeEnd: string | null = null;
      let stripeProductId: string | null = null;
      if (decision.kind !== "staff" && decision.kind !== "free") {
        const { data, error } = await supabase.functions.invoke("check-subscription");
        if (error) console.error("Sub check error:", error);
        stripeEnd = data?.subscription_end || null;
        stripeProductId = data?.product_id || null;
        // FAIL OPEN on a transient check failure (edge cold start, timeout, the 402 egress
        // outage): `data` is undefined then, and treating that as "not subscribed" showed the
        // paywall to PAYING customers. A billing-check error must never lock a customer out.
        decision = decideAccess({ ...baseInput, stripeSubscribed: error ? true : !!data?.subscribed });
      }

      switch (decision.kind) {
        case "staff":
          setSubscribed(true); setSubscriptionEnd(null); setTier("scale");
          setIsTrialing(false); setTrialEnd(null); setTrialDaysLeft(null); setTrialExpired(false);
          break;
        case "free":
        case "trial_unknown":
          setSubscribed(false); setSubscriptionEnd(null); setTier("free");
          setIsTrialing(false); setTrialEnd(null); setTrialDaysLeft(null); setTrialExpired(false);
          break;
        case "subscribed":
          setSubscribed(true); setSubscriptionEnd(stripeEnd); setTier(getTierFromProductId(stripeProductId));
          setIsTrialing(false); setTrialEnd(null); setTrialDaysLeft(null); setTrialExpired(false);
          break;
        case "trialing":
          setSubscribed(false); setSubscriptionEnd(null); setTier("free");
          setIsTrialing(true); setTrialEnd(decision.trialEnd); setTrialDaysLeft(decision.daysLeft); setTrialExpired(false);
          break;
        case "expired":
          setSubscribed(false); setSubscriptionEnd(null); setTier("free");
          setIsTrialing(false); setTrialEnd(decision.trialEnd); setTrialDaysLeft(0); setTrialExpired(true);
          break;
      }
    } catch (e) {
      console.error("Sub check failed:", e);
      resetSubscriptionState();
    } finally {
      setLoading(false);
    }
  }, [user, resetSubscriptionState]);

  // Reset state immediately when user changes, then fetch fresh data
  useEffect(() => {
    resetSubscriptionState();
    setLoading(true);
    refreshSubscription();
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps


  const limits = getPlanLimits(tier, isTrialing);

  return (
    <SubscriptionContext.Provider value={{ tier, subscribed, subscriptionEnd, loading, limits, isTrialing, trialEnd, trialExpired, trialDaysLeft, refreshSubscription }}>
      {children}
    </SubscriptionContext.Provider>
  );
}

export function useSubscription() {
  const ctx = useContext(SubscriptionContext);
  if (!ctx) throw new Error("useSubscription must be used within SubscriptionProvider");
  return ctx;
}
