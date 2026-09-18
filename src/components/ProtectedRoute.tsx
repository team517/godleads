import { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { useProfile } from "@/contexts/ProfileContext";
import { TrialExpiredScreen } from "@/components/TrialExpiredScreen";
import { isAgencyAccount } from "@/lib/access";
import { useWelcomeGate } from "@/hooks/useWelcomeGate";
import { WELCOME_PATH, shouldShowWelcome } from "@/lib/first-run";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const { loading: subLoading, trialExpired, subscribed } = useSubscription();
  const { profile, loading: profileLoading } = useProfile();
  const location = useLocation();
  const welcome = useWelcomeGate();

  if (loading || subLoading || profileLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!user) return <Navigate to="/auth" replace />;

  // Todavía no se sabe si le toca la bienvenida: mejor esperar un instante que enseñarle el
  // panel y quitárselo. Con el dato en el navegador esto no llega ni a verse.
  if (welcome === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

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


  // Primer acceso: antes que ninguna pantalla, la bienvenida (cuatro preguntas). Sólo la ve
  // quien nunca la ha hecho; las cuentas que ya existían se dieron por hechas al crear la tabla.
  if (shouldShowWelcome({
        pathname: location.pathname,
        status: welcome,
        clientLogin: !!profile.client_login_of,
        trialExpired: trialExpired && !subscribed,
      })) {
    return <Navigate to={WELCOME_PATH} replace />;
  }

  // "Clientes" (gestión de clientes del usuario final) no es para la agencia:
  // support@, equipo@, el propietario y los gestores usan /admin/clients. Se
  // bloquea también por URL, no sólo se oculta del menú.
  if (location.pathname.startsWith("/clientes")
      && isAgencyAccount(user.email ?? null, !!profile.is_client_manager)) {
    return <Navigate to="/dashboard" replace />;
  }

  // Redirect restricted users to their first allowed route
  if (profile.allowed_routes && profile.allowed_routes.length > 0) {
    const currentPath = location.pathname;
    // /settings y la bienvenida están SIEMPRE permitidas: si no, un cliente con rutas
    // acotadas rebotaría entre su primera ruta y /bienvenida sin parar.
    const isAllowed = profile.allowed_routes.some(r => currentPath.startsWith(r))
      || currentPath === "/settings" || currentPath === WELCOME_PATH;
    if (!isAllowed) {
      return <Navigate to={profile.allowed_routes[0]} replace />;
    }
  }

  return <>{children}</>;
}
