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

          <h1 className="font-display text-2xl font-bold">
            {isSignup ? "Crear cuenta" : "Iniciar sesión"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
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

          <p className="mt-6 text-center text-sm text-muted-foreground">
            {isSignup ? "¿Ya tienes cuenta?" : "¿No tienes cuenta?"}{" "}
            <button onClick={() => setIsSignup(!isSignup)} className="font-medium text-primary hover:underline">
              {isSignup ? "Inicia sesión" : "Regístrate"}
            </button>
          </p>
        </div>
      </div>

      <div className="hidden lg:flex flex-1 items-center justify-center bg-gradient-to-br from-primary/5 via-brand-cyan/5 to-brand-sky/10 border-l">
        <div className="max-w-md text-center px-8">
          <Wordmark className="mx-auto h-12" colorClassName="text-primary" />
          <h2 className="mt-6 font-display text-2xl font-bold">Escala tu outreach sin complicaciones</h2>
          <p className="mt-4 text-muted-foreground">Conecta tus cuentas, importa leads y empieza a enviar campañas personalizadas en minutos.</p>
        </div>
      </div>
    </div>
  );
}
