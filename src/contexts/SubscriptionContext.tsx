import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { decideAccess } from "@/lib/access";

export type PlanTier = "free" | "starter" | "growth" | "scale";

export const PLAN_CONFIG = {
  starter: {
    label: "Starter",
    maxLeads: 1000,
    maxAccounts: 3,
    monthly: { priceId: "price_1T45Sb2ObXNkJIexkE6GEzxU", price: 29 },
    annual: { priceId: "price_1T45Sw2ObXNkJIexJrrQjQJ5", price: 290 },
    productIds: ["prod_U29mvQRMbo5m6f", "prod_U29mwf36xp5tzO"],
  },
  growth: {
    label: "Growth",
    maxLeads: 10000,
    maxAccounts: 15,
    monthly: { priceId: "price_1T45T82ObXNkJIexHb0OjLpo", price: 79 },
    annual: { priceId: "price_1T45TQ2ObXNkJIexO5rlaZOv", price: 790 },
    productIds: ["prod_U29mEi2w9ltRwG", "prod_U29nlSXrrxJsWI"],
  },
  scale: {
    label: "Scale",
    maxLeads: Infinity,
    maxAccounts: Infinity,
    monthly: { priceId: "price_1T45Tb2ObXNkJIex9ZwHkVt8", price: 199 },
    annual: { priceId: "price_1T45Tn2ObXNkJIexpae7rzAg", price: 1990 },
    productIds: ["prod_U29nsLzCYygn4u", "prod_U29n2lYSL63LWg"],
  },
} as const;

export const FREE_LIMITS = { maxLeads: Infinity, maxAccounts: Infinity };
export const TRIAL_LIMITS = { maxLeads: Infinity, maxAccounts: Infinity };

function getTierFromProductId(productId: string | null): PlanTier {
  if (!productId) return "free";
  for (const [tier, config] of Object.entries(PLAN_CONFIG)) {
    if ((config.productIds as readonly string[]).includes(productId)) return tier as PlanTier;
  }
  return "free";
}

export function getPlanLimits(tier: PlanTier, _isTrialing: boolean) {
  if (tier === "free") return FREE_LIMITS;
  return { maxLeads: PLAN_CONFIG[tier].maxLeads, maxAccounts: PLAN_CONFIG[tier].maxAccounts };
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
        decision = decideAccess({ ...baseInput, stripeSubscribed: !!data?.subscribed });
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
