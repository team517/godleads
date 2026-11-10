import { SignupFlow } from "@/components/signup/SignupFlow";

/* Cuenta creada desde el 11-11-2026 sin prueba con tarjeta ni plan (ProtectedRoute): en lugar del
   panel ve "Activa tu prueba gratuita" — los mismos pasos del alta, sin el de crear cuenta. */
export function ActivateTrialScreen() {
  return <SignupFlow mode="activar" />;
}
