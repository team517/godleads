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

  // La cuenta de acceso de un cliente NO es un cliente de pago: no es suya la
  // suscripción ni el plan, así que nunca puede toparse con el muro de pago. Y no
  // es un usuario de la aplicación: sólo existe para mirar su área (y /settings,
  // para cambiarse la contraseña). Va ANTES de la comprobación de prueba a
  // propósito; la marca client_login_of la pone el servidor y la congela RLS.
  if (profile.client_login_of) {
    const p = location.pathname;
    if (p === "/area-cliente" || p.startsWith("/settings")) return <>{children}</>;
    return <Navigate to="/area-cliente" replace />;
  }

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
