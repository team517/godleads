import { useState, useEffect } from "react";
import { useSearchParams, Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft } from "lucide-react";
import { Wordmark } from "@/components/Wordmark";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { isSessionKept, markJustLoggedIn } from "@/components/KeepSessionBanner";

export default function Auth() {
  const [searchParams] = useSearchParams();
  const [isSignup, setIsSignup] = useState(searchParams.get("mode") === "signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const { signIn, signUp, user } = useAuth();
  const navigate = useNavigate();

  // Auto-redirect if user is already logged in (session kept or active session)
  useEffect(() => {
    if (user) {
      navigate("/dashboard", { replace: true });
    } else {
      setChecking(false);
    }
  }, [user, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (isSignup) {
        const { error, signedIn } = await signUp(email, password, fullName);
        if (error) {
          toast.error(error);
        } else if (signedIn) {
          markJustLoggedIn();
          toast.success("¡Cuenta creada! Ya puedes entrar.");
          navigate("/dashboard");
        } else {
          toast.success("¡Cuenta creada! Ya puedes iniciar sesión.");
        }
      } else {
        const { error } = await signIn(email, password);
        if (error) {
          toast.error(error);
        } else {
          markJustLoggedIn();
          navigate("/dashboard");
        }
      }
    } finally {
      setLoading(false);
    }
  };

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      <div className="flex flex-1 flex-col justify-center px-8 md:px-16 lg:px-24">
        <Link to="/" className="mb-8 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Volver al inicio
        </Link>

        <div className="mx-auto w-full max-w-sm">
          <div className="mb-8">
            <Wordmark className="h-8" colorClassName="text-primary" />
          </div>

          <h1 className="font-display text-2xl font-semibold tracking-[-0.03em]">
            {isSignup ? "Crear cuenta" : "Iniciar sesión"}
          </h1>
          <p className="mt-2 text-[15px] text-muted-foreground">
            {isSignup ? "Empieza a enviar campañas en minutos" : "Accede a tu plataforma de email marketing"}
          </p>

          <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
            {isSignup && (
              <div className="space-y-2">
                <Label htmlFor="name">Nombre completo</Label>
                <Input id="name" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Tu nombre" required />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@empresa.com" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Contraseña</Label>
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required minLength={6} />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Cargando..." : isSignup ? "Crear cuenta" : "Iniciar sesión"}
            </Button>
          </form>

          <p className="mt-6 text-center text-[15px] text-muted-foreground">
            {isSignup ? "¿Ya tienes cuenta?" : "¿No tienes cuenta?"}{" "}
            <button onClick={() => setIsSignup(!isSignup)} className="font-medium text-primary hover:underline">
              {isSignup ? "Inicia sesión" : "Regístrate"}
            </button>
          </p>
        </div>
      </div>

      {/* Panel derecho: el "hero" oscuro del diseño — índigo #312A63 con su resplandor violeta,
          titular que entra palabra a palabra y una tarjeta de producto en movimiento. */}
      <div className="relative hidden flex-1 items-center justify-center overflow-hidden lg:flex m-3 rounded-[20px] bg-[#312A63] [background-image:radial-gradient(120%_90%_at_50%_0%,rgba(160,138,255,.52)_0%,rgba(12,21,18,0)_62%),linear-gradient(180deg,rgba(167,139,250,.09)_0%,rgba(12,21,18,0)_40%)]">
        <div className="pointer-events-none absolute inset-0 opacity-60 [background-image:radial-gradient(rgba(255,255,255,.10)_1px,transparent_1.3px)] [background-size:22px_22px] [mask-image:radial-gradient(circle_at_50%_40%,#000_0%,transparent_72%)]" />
        <div className="relative w-full max-w-[460px] px-8">
          <h2 className="font-display text-[40px] font-semibold leading-[1.06] tracking-[-0.035em] text-white">
            {["Convierte", "el", "correo", "en", "frío", "en"].map((w, i) => (
              <span key={i} className="inline-block [animation:blurFadeIn_.7s_both]" style={{ animationDelay: `${0.05 + i * 0.09}s` }}>{w}&nbsp;</span>
            ))}
            <span className="inline-block bg-[linear-gradient(90deg,#7DE3FF_0%,#B79BFF_52%,#FF9BE0_100%)] bg-clip-text text-transparent [animation:blurFadeIn_.7s_both]" style={{ animationDelay: ".62s" }}>reuniones</span>
          </h2>
          <p className="mt-4 text-[16px] leading-relaxed text-[#E0DCFA] [animation:blurFadeIn_.7s_.75s_both]">
            Conecta tus cuentas, importa tus leads y deja que las campañas trabajen: llegan a la bandeja de entrada y las respuestas te esperan en un solo sitio.
          </p>

          <div className="mt-9 rounded-[14px] border border-white/15 bg-white p-4 shadow-[0_18px_38px_rgba(21,17,60,.35)] [animation:blurFadeIn_.8s_.9s_both]">
            <div className="flex items-center justify-between">
              <span className="font-display text-[15px] font-semibold tracking-[-0.02em] text-[#0F172B]">Esta semana</span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[#CDF1E3] bg-[#F1EEF8] px-2.5 py-1 text-[11px] font-semibold text-[#05A063]">
                <span className="live-dot block h-1.5 w-1.5 rounded-full bg-[#05D17F]" /> En directo
              </span>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-3 border-b border-[#EAE7F4] pb-3">
              {[["Enviados", "24.800", "#6E58F1"], ["Abiertos", "13.240", "#3B89E9"], ["Respuestas", "3.160", "#05A063"]].map(([l, v, c]) => (
                <div key={l}>
                  <p className="text-[11.5px] text-[#65768D]">{l}</p>
                  <p className="font-display text-[24px] font-semibold leading-tight tracking-[-0.03em]" style={{ color: c }}>{v}</p>
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-2.5 rounded-[9px] border border-[#E8E5F2] bg-[#FBFAFF] p-2.5 [animation:rowPop_.5s_1.5s_both]">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,#6E58F1_0%,#3B89E9_100%)] text-[11px] font-semibold text-white">EW</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12.5px] font-semibold text-[#0F172B]">Emma Walsh · Voltera</p>
                <p className="truncate text-[12px] text-[#45556C]">Me interesa, ¿cómo sería para un equipo de doce?</p>
              </div>
              <span className="shrink-0 rounded-full bg-[#CDF1E3] px-2 py-0.5 text-[10.5px] font-semibold text-[#0A7A52]">Interesado</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
