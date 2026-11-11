import { useAuth } from "@/contexts/AuthContext";
import { useProfile } from "@/contexts/ProfileContext";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { canUseFunnyTeam, isAgencyAccount } from "@/lib/access";

/** ¿Puede esta cuenta usar Funny Team? Clientes nuevos con suscripción activa o en prueba, y el
 *  equipo de la agencia. Los clientes del portal de la agencia, no. */
export function useFunnyTeamAccess(): { allowed: boolean; loading: boolean } {
  const { user } = useAuth();
  const { profile } = useProfile();
  const { status, isAdmin, loading } = useSubscription();
  const isAgency = isAgencyAccount(user?.email ?? null, !!profile.is_client_manager) || isAdmin;
  return { allowed: canUseFunnyTeam(status, isAgency), loading };
}
