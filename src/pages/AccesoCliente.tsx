import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { AlertCircle, ArrowRight, Eye, EyeOff, Loader2, Lock, Mail } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { rememberClientSlug } from "@/lib/client-access";

/* Entrada exclusiva para los clientes de una agencia (12-11-2026): /acceso/<slug>.
   Sale el logo, el nombre y el color de la AGENCIA (nada de Funnyleads ni de "crear cuenta").
   Sólo deja entrar a las cuentas de cliente de esa agencia; al entrar, el panel ya lleva el logo
   y el color del propio cliente. /acceso-cliente (sin agencia) es la versión neutra. */

type Branding = { agency_name: string | null; logo_url: string | null; brand_color: string | null };
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** Color con transparencia a partir de #RRGGBB. Pura. */
export function withAlpha(hex: string, alpha: number): string {
  const h = HEX_RE.test(hex) ? hex.slice(1) : "6E58F1";
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export default function AccesoCliente() {
  const { slug: rawSlug } = useParams();
  const slug = (rawSlug || "").toLowerCase();
  const navigate = useNavigate();
  const [brand, setBrand] = useState<Branding | null>(null);
  const [estado, setEstado] = useState<"cargando" | "listo" | "no-existe">(slug ? "cargando" : "listo");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [verPass, setVerPass] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sesionDe, setSesionDe] = useState<string | null>(null);

  const color = brand?.brand_color && HEX_RE.test(brand.brand_color) ? brand.brand_color : "#6E58F1";
  // Nombre de la agencia tal cual (vacío si no lo ha puesto); para frases, "tu agencia".
  const nombre = brand?.agency_name?.trim() || "";
  const deQuien = nombre || "tu agencia";

  // La marca de la agencia (pública: sólo nombre, logo y color).
  useEffect(() => {
    if (!slug) return;
    let vivo = true;
    (async () => {
      const { data } = await (supabase as any).rpc("client_login_branding", { p_slug: slug });
      if (!vivo) return;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) { setEstado("no-existe"); return; }
      setBrand(row as Branding);
      setEstado("listo");
    })();
    return () => { vivo = false; };
  }, [slug]);

  useEffect(() => {
    document.title = nombre ? `Acceso de clientes · ${nombre}` : "Acceso de clientes";
  }, [nombre]);

  /** ¿La cuenta con sesión es cliente de esta agencia (o, sin agencia, cliente de alguien)? */
  const perteneceAqui = async (): Promise<boolean> => {
    if (slug) {
      const { data } = await (supabase as any).rpc("client_login_belongs", { p_slug: slug });
      return data === true;
    }
    const { data } = await (supabase as any).rpc("my_client_context");
    return Array.isArray(data) ? data.length > 0 : !!data;
  };

  // Si ya hay sesión de un cliente de esta agencia, se ofrece entrar directamente.
  useEffect(() => {
    if (estado !== "listo") return;
    let vivo = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      const mail = data.session?.user?.email || null;
      if (!mail || !vivo) return;
      if (await perteneceAqui()) { if (vivo) setSesionDe(mail); }
    })();
    return () => { vivo = false; };
  }, [estado]); // eslint-disable-line react-hooks/exhaustive-deps

  const entrarAlPanel = () => {
    if (slug) rememberClientSlug(slug);
    navigate("/dashboard", { replace: true });
  };

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (enviando) return;
    setError(null);
    const mail = email.trim().toLowerCase();
    if (!mail || !password) { setError("Escribe tu email y tu contraseña."); return; }
    setEnviando(true);
    const { error: authErr } = await supabase.auth.signInWithPassword({ email: mail, password });
    if (authErr) {
      setEnviando(false);
      setError(/invalid|credentials/i.test(authErr.message) ? "El email o la contraseña no son correctos." : "No hemos podido entrar. Inténtalo de nuevo en un momento.");
      return;
    }
    if (!(await perteneceAqui())) {
      // Cuenta válida pero no es un cliente de esta agencia: no se le deja la sesión abierta aquí.
      await supabase.auth.signOut({ scope: "local" });
      setEnviando(false);
      setError(slug
        ? `Esta entrada es solo para los clientes de ${deQuien}. Si tienes una cuenta propia de Funnyleads, entra desde funnyleads.com.`
        : "Esta entrada es solo para cuentas de cliente. Si tienes una cuenta propia, entra desde funnyleads.com.");
      return;
    }
    entrarAlPanel();
  };

  const fondo = useMemo(() => ({
    background: `radial-gradient(60% 50% at 15% 10%, ${withAlpha(color, 0.14)} 0%, transparent 70%), radial-gradient(50% 45% at 90% 90%, ${withAlpha(color, 0.12)} 0%, transparent 70%), #F8F7FC`,
  }), [color]);

  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center px-4 py-10 text-[#0F172B]" style={fondo} data-testid="acceso-cliente">
      <motion.div
        initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: "easeOut" }}
        className="w-full max-w-[420px]"
      >
        {estado === "cargando" && (
          <div className="flex justify-center py-24"><Loader2 className="h-8 w-8 animate-spin" style={{ color }} aria-label="Cargando" /></div>
        )}

        {estado === "no-existe" && (
          <section className="rounded-[22px] border border-[#E6E3F0] bg-white p-8 text-center shadow-[0_24px_60px_-24px_rgba(30,20,90,.25)]" role="alert">
            <AlertCircle className="mx-auto h-9 w-9 text-[#6E58F1]" aria-hidden="true" />
            <h1 className="mt-4 font-display text-[22px] font-semibold tracking-[-0.03em]">Esta dirección de acceso no existe</h1>
            <p className="mt-2 text-[14.5px] text-[#45556C]">Revisa el enlace que te ha mandado tu agencia: puede que esté incompleto o que haya cambiado.</p>
          </section>
        )}

        {estado === "listo" && (
          <section className="overflow-hidden rounded-[24px] border border-white bg-white/95 shadow-[0_30px_70px_-28px_rgba(30,20,90,.35)] backdrop-blur">
            <div className="h-1.5 w-full" style={{ background: `linear-gradient(90deg, ${color}, ${withAlpha(color, 0.45)})` }} />
            <div className="px-7 pb-7 pt-8 sm:px-9">
              {/* Marca de la agencia */}
              <div className="flex flex-col items-center text-center">
                {brand?.logo_url ? (
                  <span className="flex h-16 min-w-16 max-w-[220px] items-center justify-center rounded-2xl border border-[#EEEBF7] bg-white px-3 shadow-[0_8px_24px_-12px_rgba(30,20,90,.25)]">
                    <img src={brand.logo_url} alt={nombre || "Logo"} className="max-h-11 max-w-[190px] object-contain" />
                  </span>
                ) : nombre ? (
                  <span className="flex h-16 w-16 items-center justify-center rounded-2xl text-[26px] font-bold text-white shadow-[0_10px_26px_-10px_rgba(30,20,90,.45)]" style={{ background: `linear-gradient(135deg, ${color}, ${withAlpha(color, 0.75)})` }}>
                    {nombre.charAt(0).toUpperCase()}
                  </span>
                ) : (
                  <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#F1EEF8]"><Lock className="h-7 w-7 text-[#6E58F1]" /></span>
                )}
                <p className="mt-5 text-[12px] font-semibold uppercase tracking-[0.12em]" style={{ color }}>Acceso de clientes</p>
                <h1 className="mt-1.5 font-display text-[26px] font-semibold leading-tight tracking-[-0.03em]">
                  {nombre ? <>Entra en tu panel de {nombre}</> : "Entra en tu panel"}
                </h1>
                <p className="mt-2 text-[14.5px] text-[#45556C]">Tus campañas, tus respuestas y tus resultados, en un solo sitio.</p>
              </div>

              {sesionDe ? (
                <div className="mt-7 space-y-3 text-center">
                  <p className="text-[14px] text-[#45556C]">Ya has iniciado sesión como <strong className="text-[#0F172B]">{sesionDe}</strong>.</p>
                  <button type="button" onClick={entrarAlPanel} className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl text-[15px] font-semibold text-white shadow-[0_12px_24px_-10px_rgba(30,20,90,.45)] transition hover:brightness-110" style={{ background: color }}>
                    Entrar en el panel <ArrowRight className="h-4 w-4" />
                  </button>
                  <button type="button" onClick={async () => { await supabase.auth.signOut({ scope: "local" }); setSesionDe(null); }} className="text-[13px] font-medium text-[#65768D] hover:text-[#0F172B]">
                    Entrar con otra cuenta
                  </button>
                </div>
              ) : (
                <form onSubmit={enviar} className="mt-7 space-y-4" noValidate>
                  <div className="space-y-1.5">
                    <label htmlFor="ac-email" className="text-[13.5px] font-medium">Email</label>
                    <div className="flex h-12 items-center gap-2.5 rounded-xl border border-[#E2DEEF] bg-white px-3.5 transition-shadow focus-within:shadow-[0_0_0_4px_var(--ac-ring)]" style={{ ["--ac-ring" as any]: withAlpha(color, 0.18) }}>
                      <Mail className="h-4 w-4 shrink-0 text-[#94A0B4]" aria-hidden="true" />
                      <input id="ac-email" type="email" autoComplete="email" value={email} onChange={(e) => { setEmail(e.target.value); setError(null); }}
                        placeholder="tu@empresa.com" className="h-full w-full bg-transparent text-[15px] outline-none placeholder:text-[#A3ACBE]" />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="ac-pass" className="text-[13.5px] font-medium">Contraseña</label>
                    <div className="flex h-12 items-center gap-2.5 rounded-xl border border-[#E2DEEF] bg-white px-3.5 transition-shadow focus-within:shadow-[0_0_0_4px_var(--ac-ring)]" style={{ ["--ac-ring" as any]: withAlpha(color, 0.18) }}>
                      <Lock className="h-4 w-4 shrink-0 text-[#94A0B4]" aria-hidden="true" />
                      <input id="ac-pass" type={verPass ? "text" : "password"} autoComplete="current-password" value={password} onChange={(e) => { setPassword(e.target.value); setError(null); }}
                        className="h-full w-full bg-transparent text-[15px] outline-none" />
                      <button type="button" onClick={() => setVerPass((v) => !v)} aria-label={verPass ? "Ocultar la contraseña" : "Ver la contraseña"} className="text-[#94A0B4] hover:text-[#45556C]">
                        {verPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                  {error && (
                    <p className="flex items-start gap-2 rounded-xl border border-[#F5C2C2] bg-[#FFF5F5] px-3 py-2.5 text-[13.5px] text-[#B42318]" role="alert">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
                    </p>
                  )}
                  <button type="submit" disabled={enviando} className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl text-[15px] font-semibold text-white shadow-[0_12px_24px_-10px_rgba(30,20,90,.45)] transition hover:brightness-110 disabled:opacity-70" style={{ background: `linear-gradient(135deg, ${color}, ${withAlpha(color, 0.82)})` }}>
                    {enviando ? <><Loader2 className="h-4 w-4 animate-spin" /> Entrando…</> : <>Entrar <ArrowRight className="h-4 w-4" /></>}
                  </button>
                  <p className="text-center text-[13px] text-[#65768D]">
                    ¿Olvidaste tu contraseña? Pídele una nueva a {deQuien}.
                  </p>
                </form>
              )}
            </div>
          </section>
        )}
        <p className="mt-6 text-center text-[11.5px] text-[#94A0B4]">Con tecnología de Funnyleads</p>
      </motion.div>
    </div>
  );
}
