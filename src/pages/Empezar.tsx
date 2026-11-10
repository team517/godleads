import { useEffect } from "react";
import { SignupFlow } from "@/components/signup/SignupFlow";

/* /empezar — alta con prueba gratuita de 14 días (11-11-2026): plan, cuenta y tarjeta. Pública: el
   visitante aún no tiene cuenta. El acceso al panel lo da después la suscripción guardada por el
   webhook de Stripe, nunca esta página. */
export default function Empezar() {
  useEffect(() => {
    const prev = document.title;
    document.title = "Empieza gratis · Funnyleads";
    return () => { document.title = prev; };
  }, []);
  return <SignupFlow mode="alta" />;
}
