import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { AlertCircle, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Wordmark } from "@/components/Wordmark";
import { supabase } from "@/integrations/supabase/client";

/* /empezar/verificar?t=… (11-11-2026): el botón "Verificar mi cuenta" del correo que manda team@.
   Confirma el correo en el servidor, abre la sesión en este dispositivo y pasa directo al paso de la
   tarjeta. La pestaña donde se hizo el alta también se entera sola (ConfirmaCorreo). */

type Estado = "verificando" | "verificado" | "caducado" | "invalido" | "hecho" | "error";

const MENSAJES: Record<Exclude<Estado, "verificando" | "verificado">, { titulo: string; texto: string }> = {
  caducado: { titulo: "El enlace ha caducado", texto: "Los enlaces de verificación duran 48 horas. Vuelve a empezar el alta y te mandamos uno nuevo." },
  invalido: { titulo: "Este enlace no es válido", texto: "Puede que esté incompleto. Abre el botón del último correo que te hemos enviado." },
  hecho: { titulo: "Tu cuenta ya está activa", texto: "Ya completaste el alta. Inicia sesión para entrar en Funnyleads." },
  error: { titulo: "No hemos podido verificar tu cuenta", texto: "Inténtalo de nuevo en un momento. Si sigue pasando, escríbenos a team@onepulso.online." },
};

export default function VerificarCuenta() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [estado, setEstado] = useState<Estado>("verificando");
  const una = useRef(false);

  useEffect(() => {
    if (una.current) return;
    una.current = true;
    document.title = "Verificar cuenta · Funnyleads";
    const token = params.get("t") || "";
    (async () => {
      if (!token) { setEstado("invalido"); return; }
      const { data, error } = await supabase.functions.invoke("signup-flow", { body: { action: "verify", token } });
      let code = (data as any)?.error as string | undefined;
      if (error) {
        try { code = (await (error as any).context?.json?.())?.error; } catch { /* sin cuerpo */ }
      }
      if (code === "expired_link") { setEstado("caducado"); return; }
      if (code === "invalid_link") { setEstado("invalido"); return; }
      if (code === "already_done") { setEstado("hecho"); return; }
      if (error || !(data as any)?.verified) { setEstado("error"); return; }

      const d = data as { email: string; token_hash?: string; plan?: string; period?: string };
      // Si este navegador tenía abierta otra cuenta, se cierra antes de abrir la nueva.
      const { data: actual } = await supabase.auth.getSession();
      if (actual.session && actual.session.user.email?.toLowerCase() !== d.email.toLowerCase()) {
        await supabase.auth.signOut({ scope: "local" });
      }
      if (d.token_hash) {
        await supabase.auth.verifyOtp({ type: "magiclink", token_hash: d.token_hash });
      }
      try { sessionStorage.setItem("fl_signup_verified", "1"); } catch { /* sin almacenamiento */ }
      setEstado("verificado");
      // Plan a medida: el servidor lo guarda como "custom-N" → plan=custom&nivel=N.
      const medida = /^custom-(\d{1,2})$/.exec(d.plan || "");
      const q = new URLSearchParams({ paso: "tarjeta", plan: medida ? "custom" : d.plan || "starter", periodo: d.period || "month", verificado: "1" });
      if (medida) q.set("nivel", medida[1]);
      setTimeout(() => navigate(`/empezar?${q.toString()}`, { replace: true }), 1500);
    })();
  }, [params, navigate]);

  return (
    <div className="flex min-h-screen flex-col items-center bg-[#FBFAFE] px-5 py-6">
      <Wordmark className="h-6" colorClassName="text-[#0F172B]" />
      <div className="mt-16 w-full max-w-[480px]">
        {estado === "verificando" && (
          <section className="rounded-[16px] border border-[#E6E3F0] bg-white p-8 text-center" aria-live="polite">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-[#6E58F1]" aria-hidden="true" />
            <h1 className="mt-4 font-display text-[22px] font-semibold tracking-[-0.03em] text-[#0F172B]">Verificando tu cuenta…</h1>
          </section>
        )}
        {estado === "verificado" && (
          <section className="rounded-[16px] border border-[#CDEFD9] bg-white p-8 text-center" aria-live="polite">
            <motion.span
              initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 320, damping: 18 }}
              className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#E7F8EE] text-[#16A34A]"
            >
              <Check className="h-7 w-7" strokeWidth={3} />
            </motion.span>
            <h1 className="mt-4 font-display text-[24px] font-semibold tracking-[-0.03em] text-[#0F172B]">¡Cuenta verificada!</h1>
            <p className="mt-2 inline-flex items-center gap-2 text-[15px] text-[#45556C]"><Loader2 className="h-4 w-4 animate-spin" /> Te llevamos al último paso: tu tarjeta…</p>
          </section>
        )}
        {estado !== "verificando" && estado !== "verificado" && (
          <section className="rounded-[16px] border border-[#E6E3F0] bg-white p-8 text-center" role="alert">
            <AlertCircle className="mx-auto h-9 w-9 text-[#6E58F1]" aria-hidden="true" />
            <h1 className="mt-4 font-display text-[22px] font-semibold tracking-[-0.03em] text-[#0F172B]">{MENSAJES[estado].titulo}</h1>
            <p className="mt-2 text-[15px] text-[#45556C]">{MENSAJES[estado].texto}</p>
            <Button asChild className="mt-5">
              {estado === "hecho" ? <Link to="/auth">Iniciar sesión</Link> : <Link to="/empezar">Volver al alta</Link>}
            </Button>
          </section>
        )}
      </div>
    </div>
  );
}
