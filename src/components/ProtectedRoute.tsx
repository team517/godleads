import { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { useProfile } from "@/contexts/ProfileContext";
import { TrialExpiredScreen } from "@/components/TrialExpiredScreen";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const { loading: subLoading } = useSubscription();
  const { profile } = useProfile();
  const location = useLocation();

  if (loading || subLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!user) return <Navigate to="/auth" replace />;


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
