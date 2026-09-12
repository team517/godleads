import { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { useProfile } from "@/contexts/ProfileContext";
import { TrialExpiredScreen } from "@/components/TrialExpiredScreen";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const { loading: subLoading, trialExpired, subscribed } = useSubscription();
  const { profile, loading: profileLoading } = useProfile();
  const location = useLocation();

  if (loading || subLoading || profileLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!user) return <Navigate to="/auth" replace />;

  // La cuenta de un cliente es una cuenta NORMAL de la plataforma: entra al mismo
  // producto, con sus propias campañas, buzones, leads y Unibox bajo su user_id
  // (RLS ya los aísla). Lo único que la acota son sus `allowed_routes`, que escribe
  // el servidor desde las secciones que le abre su dueño — ver más abajo.
  //
  // Nunca se topa con el muro de pago: paga su dueño. Eso lo garantiza
  // decideAccess (allowed_routes no vacío → "free", así que trialExpired es false);
  // está fijado en src/test/client-account-access.test.ts.

  // Paywall: a NEW self-signup whose 5-day trial ended (and hasn't subscribed) must pay to continue.
  // Staff, admin-created clients, grandfathered accounts and subscribers never reach here — the
  // SubscriptionContext leaves trialExpired=false for all of them. /settings stays reachable so they
  // can manage their account. (subscribed is double-checked so a just-paid user is never blocked.)
  if (trialExpired && !subscribed && location.pathname !== "/settings") {
    return <TrialExpiredScreen />;
  }


  // Redirect restricted users to their first allowed route
  if (profile.allowed_routes && profile.allowed_routes.length > 0) {
    const currentPath = location.pathname;
    const isAllowed = profile.allowed_routes.some(r => currentPath.startsWith(r)) || currentPath === "/settings";
    if (!isAllowed) {
      return <Navigate to={profile.allowed_routes[0]} replace />;
    }
  }

  return <>{children}</>;
}
