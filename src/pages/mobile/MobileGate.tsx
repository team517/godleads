import { Navigate } from "react-router-dom";
import { useProfile } from "@/contexts/ProfileContext";
import { lazyWithRetry } from "@/lib/lazy-retry";
import { isInstalledApp, isPhoneDevice, uniboxAllowed } from "@/lib/mobile-app";
import { Suspense } from "react";

const MobileApp = lazyWithRetry(() => import("./MobileApp"));

/** Entrada de /m: sólo para quien puede ver la Unibox. La app instalada en un ORDENADOR sigue
 *  abriendo el panel normal (la de móvil es para el teléfono). */
export default function MobileGate() {
  const { profile } = useProfile();
  if (!uniboxAllowed(profile.allowed_routes)) {
    return <Navigate to={profile.allowed_routes?.[0] || "/dashboard"} replace />;
  }
  if (isInstalledApp() && !isPhoneDevice()) return <Navigate to="/dashboard" replace />;
  return (
    <Suspense fallback={<div className="fixed inset-0 bg-white" />}>
      <MobileApp />
    </Suspense>
  );
}
