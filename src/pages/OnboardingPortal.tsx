import { useEffect, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Rocket, Check, LogOut, Building2, ExternalLink } from "lucide-react";
import { PHASES, STATE_META, normalizeStatus, progressPct, type PhaseState } from "@/lib/onboarding";

type Branding = { company_name: string | null; logo_url: string | null; brand_color: string | null };
type Me = Branding & { onboarding_status: PhaseState[] };

export default function OnboardingPortal() {
  const { slug } = useParams<{ slug: string }>();
  const { user, signIn, signOut, loading: authLoading } = useAuth();
  const [branding, setBranding] = useState<Branding | null>(null);
  const [brandingLoaded, setBrandingLoaded] = useState(false);

  // Pre-login branding by slug (public RPC, anon).
  useEffect(() => {
    (async () => {
      if (!slug) { setBrandingLoaded(true); return; }
      const { data } = await (supabase as any).rpc("onboarding_public", { p_slug: slug });
      const row = Array.isArray(data) ? data[0] : data;
      setBranding(row || null);
      setBrandingLoaded(true);
    })();
  }, [slug]);

  const accent = branding?.brand_color || "#6E58F1";

  if (authLoading || !brandingLoaded) {
    return <div className="flex min-h-screen items-center justify-center bg-background"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-muted/30 to-background">
      <div className="mx-auto flex min-h-screen max-w-lg flex-col px-4 py-8">
        {/* Brand header */}
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          {branding?.logo_url
            ? <img src={branding.logo_url} alt={branding.company_name || ""} className="h-14 max-w-[200px] object-contain" />
            : <span className="flex h-14 w-14 items-center justify-center rounded-xl" style={{ background: `${accent}22`, color: accent }}><Building2 className="h-7 w-7" /></span>}
          {branding?.company_name && <p className="font-display text-lg font-semibold">{branding.company_name}</p>}
        </div>

        {user
          ? <Progress accent={accent} onSignOut={signOut} />
          : <LoginForm accent={accent} signIn={signIn} companyName={branding?.company_name} />}

        <p className="mt-auto pt-8 text-center text-[11px] text-muted-foreground">
          Progreso de tu proyecto · <span style={{ color: accent }}>OnePulso</span>
        </p>
      </div>
    </div>
  );
}

function LoginForm({ accent, signIn, companyName }: { accent: string; signIn: (e: string, p: string) => Promise<{ error: string | null }>; companyName?: string | null }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) { setErr("Introduce tu email y contraseña"); return; }
    setBusy(true); setErr(null);
    const { error } = await signIn(email.trim().toLowerCase(), password);
    if (error) setErr("Email o contraseña incorrectos.");
    setBusy(false);
  };

  return (
    <div className="rounded-2xl border border-border/60 bg-card p-6 shadow-sm">
      <h1 className="flex items-center justify-center gap-2 text-center font-display text-xl font-bold">
        <Rocket className="h-5 w-5" style={{ color: accent }} /> Acceso a tu onboarding
      </h1>
      <p className="mt-1 text-center text-sm text-muted-foreground">
        Entra con las credenciales que te dio {companyName ? companyName : "tu agencia"} para ver el progreso de tu proyecto.
      </p>
      <form onSubmit={submit} className="mt-5 space-y-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Email</Label>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@empresa.com" autoComplete="username" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Contraseña</Label>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete="current-password" />
        </div>
        {err && <p className="text-xs text-destructive">{err}</p>}
        <Button type="submit" disabled={busy} className="w-full gap-2" style={{ background: accent }}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Entrar
        </Button>
      </form>
      <p className="mt-4 text-center text-[11px] text-muted-foreground">
        Con estas mismas credenciales también puedes entrar a la <a href="/auth" className="underline hover:text-foreground">plataforma completa</a>.
      </p>
    </div>
  );
}

function Progress({ accent, onSignOut }: { accent: string; onSignOut: () => void }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data } = await (supabase as any).rpc("onboarding_me");
    const row = Array.isArray(data) ? data[0] : data;
    setMe(row ? { ...row, onboarding_status: normalizeStatus(row.onboarding_status) } : null);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    // Live-ish: refresh when the tab regains focus so the client sees updates the owner makes.
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    const iv = setInterval(load, 60000);
    return () => { window.removeEventListener("focus", onFocus); clearInterval(iv); };
  }, [load]);

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  const status = me?.onboarding_status || normalizeStatus([]);
  const pct = progressPct(status);
  const doneCount = status.filter((s) => s === "done").length;

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-border/60 bg-card p-6 shadow-sm">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-sm text-muted-foreground">Progreso de tu onboarding</p>
            <p className="font-display text-3xl font-bold" style={{ color: accent }}>{pct}%</p>
          </div>
          <p className="text-xs text-muted-foreground">{doneCount} de {PHASES.length} fases completadas</p>
        </div>
        <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: accent }} />
        </div>
      </div>

      <div className="space-y-2.5">
        {PHASES.map((p, i) => {
          const st = status[i];
          const meta = STATE_META[st];
          return (
            <div key={p.key} className={`flex items-start gap-3 rounded-xl border p-3.5 ${st === "done" ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-500/20 dark:bg-emerald-500/5" : "border-border/60 bg-card"}`}>
              <span
                className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                style={{ background: st === "done" ? "#10b981" : st === "in_progress" ? "#f59e0b" : undefined }}
              >
                {st === "done" ? <Check className="h-4 w-4" /> : <span className={st === "pending" ? "text-muted-foreground" : ""}>{i + 1}</span>}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold">{p.title}</p>
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${meta.badge}`}>{meta.label}</span>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">{p.description}</p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between pt-1">
        <a href="/dashboard" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
          <ExternalLink className="h-3.5 w-3.5" /> Ir a la plataforma
        </a>
        <button onClick={onSignOut} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-destructive">
          <LogOut className="h-3.5 w-3.5" /> Cerrar sesión
        </button>
      </div>
    </div>
  );
}
