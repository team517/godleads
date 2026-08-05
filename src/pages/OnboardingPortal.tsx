import { useEffect, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2, Check, LogOut, ArrowUpRight } from "lucide-react";
import { PHASES, normalizeStatus, progressPct, type PhaseState } from "@/lib/onboarding";

type Branding = { company_name: string | null; logo_url: string | null; brand_color: string | null };
type Me = Branding & { onboarding_status: PhaseState[] };

const ACCENT_DEFAULT = "#6E58F1";

function hexToRgba(hex: string, a: number): string {
  const h = (hex || "").replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(n.slice(0, 2), 16), g = parseInt(n.slice(2, 4), 16), b = parseInt(n.slice(4, 6), 16);
  if ([r, g, b].some((v) => Number.isNaN(v))) return `rgba(110,88,241,${a})`;
  return `rgba(${r},${g},${b},${a})`;
}

// Subtle, on-brand backdrop: violet-tinted radial wash + masked grid + top glow.
function Backdrop({ accent }: { accent: string }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute inset-0" style={{ background: `radial-gradient(120% 78% at 50% -8%, #FFFFFF 0%, ${hexToRgba(accent, 0.13)} 46%, #FAFAF7 100%)` }} />
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `linear-gradient(${hexToRgba(accent, 0.06)} 1px,transparent 1px),linear-gradient(90deg,${hexToRgba(accent, 0.06)} 1px,transparent 1px)`,
          backgroundSize: "54px 54px",
          WebkitMaskImage: "radial-gradient(90% 55% at 50% 12%, #000 6%, transparent 76%)",
          maskImage: "radial-gradient(90% 55% at 50% 12%, #000 6%, transparent 76%)",
        }}
      />
      <div className="absolute left-1/2 top-[-180px] h-[540px] w-[540px] -translate-x-1/2 rounded-full" style={{ background: `radial-gradient(circle, ${hexToRgba(accent, 0.20)} 0%, transparent 62%)` }} />
    </div>
  );
}

const PILL: Record<PhaseState, string> = {
  pending: "bg-[#F1F1EE] text-[#7A7A7A] border-[#E4E4DF]",
  in_progress: "bg-amber-50 text-amber-700 border-amber-200",
  done: "bg-emerald-50 text-emerald-700 border-emerald-200",
};
const PILL_LABEL: Record<PhaseState, string> = { pending: "Pendiente", in_progress: "En curso", done: "Completado" };

export default function OnboardingPortal() {
  const { slug } = useParams<{ slug: string }>();
  const { user, signIn, signOut, loading: authLoading } = useAuth();
  const [branding, setBranding] = useState<Branding | null>(null);
  const [brandingLoaded, setBrandingLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      if (!slug) { setBrandingLoaded(true); return; }
      const { data } = await (supabase as any).rpc("onboarding_public", { p_slug: slug });
      setBranding((Array.isArray(data) ? data[0] : data) || null);
      setBrandingLoaded(true);
    })();
  }, [slug]);

  const accent = branding?.brand_color || ACCENT_DEFAULT;

  if (authLoading || !brandingLoaded) {
    return <div className="flex min-h-screen items-center justify-center bg-[#FAFAF7]"><Loader2 className="h-6 w-6 animate-spin text-[#9C9C9C]" /></div>;
  }

  return (
    <div className="relative min-h-screen bg-[#FAFAF7] text-[#111111]">
      <Backdrop accent={accent} />

      {/* Header — co-branded: OnePulso + the client's own logo */}
      <header className="relative z-10 mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-3">
          <img src="/onepulso-logo-transparent.png" alt="OnePulso" className="h-6 w-auto" />
          {branding?.logo_url && (
            <>
              <span className="h-6 w-px bg-[#E0E0DB]" aria-hidden />
              <img src={branding.logo_url} alt={branding.company_name || "Cliente"} className="h-7 max-w-[140px] object-contain" />
            </>
          )}
        </div>
        {user && (
          <button onClick={signOut} className="inline-flex items-center gap-1.5 rounded-full border border-[#E4E4DF] bg-white/70 px-3 py-1.5 text-xs font-medium text-[#5C5C5C] backdrop-blur transition-colors hover:text-[#111]">
            <LogOut className="h-3.5 w-3.5" /> Salir
          </button>
        )}
      </header>

      <main className="relative z-10 mx-auto w-full max-w-5xl px-6 pb-24">
        {user
          ? <Progress accent={accent} branding={branding} />
          : <LoginView accent={accent} signIn={signIn} companyName={branding?.company_name} logoUrl={branding?.logo_url} />}
      </main>

      <footer className="relative z-10 mx-auto flex w-full max-w-5xl items-center justify-center gap-2 px-6 pb-8 text-center text-[11px] text-[#9C9C9C]">
        Portal de onboarding · <span style={{ color: accent }} className="font-medium">OnePulso</span>
      </footer>
    </div>
  );
}

// ───────────────────────── Login ─────────────────────────
function LoginView({ accent, signIn, companyName, logoUrl }: {
  accent: string; signIn: (e: string, p: string) => Promise<{ error: string | null }>;
  companyName?: string | null; logoUrl?: string | null;
}) {
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
    <div className="grid items-center gap-12 pt-10 md:grid-cols-2 md:pt-20">
      {/* Left — brand moment */}
      <div className="order-2 md:order-1">
        <p className="text-[12px] font-medium uppercase tracking-[0.16em]" style={{ color: accent }}>Portal de onboarding</p>
        <h1 className="mt-4 font-display text-[clamp(40px,6vw,68px)] font-extrabold leading-[0.98] tracking-[-0.035em]">
          Tu proyecto,<br />
          <span className="font-serif font-normal italic" style={{ color: accent }}>paso a paso</span>.
        </h1>
        <p className="mt-5 max-w-md text-[17px] leading-relaxed text-[#5C5C5C]">
          Entra con las credenciales que te dio {companyName || "tu agencia"} y sigue el progreso de tu onboarding en tiempo real.
        </p>
        {logoUrl && (
          <div className="mt-8 flex items-center gap-3 text-sm text-[#9C9C9C]">
            <span>Proyecto de</span>
            <img src={logoUrl} alt={companyName || ""} className="h-7 max-w-[140px] object-contain" />
          </div>
        )}
      </div>

      {/* Right — login card */}
      <div className="order-1 md:order-2">
        <div className="mx-auto w-full max-w-sm rounded-2xl border border-[#ECECE8] bg-white p-7 shadow-[0_18px_50px_rgba(10,10,10,0.08)]">
          <h2 className="font-display text-xl font-bold tracking-[-0.01em]">Acceso a tu onboarding</h2>
          <p className="mt-1 text-sm text-[#7A7A7A]">Introduce tus datos para continuar.</p>
          <form onSubmit={submit} className="mt-6 space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[#5C5C5C]">Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@empresa.com" autoComplete="username"
                className="h-11 w-full rounded-xl border border-[#E4E4DF] bg-[#FAFAF9] px-3.5 text-[15px] outline-none transition focus:border-transparent focus:ring-2"
                style={{ ["--tw-ring-color" as any]: hexToRgba(accent, 0.5) }} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[#5C5C5C]">Contraseña</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete="current-password"
                className="h-11 w-full rounded-xl border border-[#E4E4DF] bg-[#FAFAF9] px-3.5 text-[15px] outline-none transition focus:border-transparent focus:ring-2"
                style={{ ["--tw-ring-color" as any]: hexToRgba(accent, 0.5) }} />
            </div>
            {err && <p className="text-xs text-red-600">{err}</p>}
            <button type="submit" disabled={busy}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-xl text-[15px] font-semibold text-white shadow-sm transition-transform active:scale-[0.99] disabled:opacity-70"
              style={{ background: accent }}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Entrar
            </button>
          </form>
          <p className="mt-5 text-center text-[11px] text-[#9C9C9C]">
            Con estas credenciales también entras a la <a href="/auth" className="underline underline-offset-2 hover:text-[#111]">plataforma completa</a>.
          </p>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── Progress ─────────────────────────
function Progress({ accent, branding }: { accent: string; branding: Branding | null }) {
  const { user } = useAuth();
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
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    const iv = setInterval(load, 30000); // fallback poll; realtime below is near-instant

    // Realtime: refresh the moment the owner changes THIS client's onboarding.
    // RLS ("Users can read own profile") means only the client's own row is delivered.
    let channel: ReturnType<typeof supabase.channel> | null = null;
    if (user?.id) {
      channel = supabase
        .channel(`onboarding-me-${user.id}`)
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "profiles", filter: `user_id=eq.${user.id}` },
          () => load(),
        )
        .subscribe();
    }

    return () => {
      window.removeEventListener("focus", onFocus);
      clearInterval(iv);
      if (channel) supabase.removeChannel(channel);
    };
  }, [load, user?.id]);

  if (loading) return <div className="flex justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-[#9C9C9C]" /></div>;

  const company = me?.company_name || branding?.company_name || null;
  const logoUrl = me?.logo_url || branding?.logo_url || null;
  const status = me?.onboarding_status || normalizeStatus([]);
  const pct = progressPct(status);
  const doneCount = status.filter((s) => s === "done").length;

  return (
    <div className="pt-8 md:pt-14">
      {/* Hero — horizontal: identity left, big progress number right */}
      <div className="grid items-center gap-10 md:grid-cols-[1.1fr_0.9fr]">
        <div>
          <div className="flex items-center gap-3">
            {logoUrl && <img src={logoUrl} alt={company || ""} className="h-9 max-w-[150px] object-contain" />}
            <p className="text-[12px] font-medium uppercase tracking-[0.16em]" style={{ color: accent }}>Onboarding{company ? ` · ${company}` : ""}</p>
          </div>
          <h1 className="mt-4 font-display text-[clamp(38px,5.2vw,60px)] font-extrabold leading-[0.98] tracking-[-0.035em]">
            El progreso de tu<br /><span className="font-serif font-normal italic" style={{ color: accent }}>proyecto</span>.
          </h1>
          <p className="mt-4 max-w-md text-[16px] leading-relaxed text-[#5C5C5C]">
            Estas son las 6 fases de tu onboarding. Las vamos completando y aquí lo ves en tiempo real.
          </p>
        </div>

        {/* Big stat block — "6M+" style */}
        <div className="rounded-3xl border border-[#ECECE8] bg-white/70 p-8 shadow-[0_18px_50px_rgba(10,10,10,0.06)] backdrop-blur">
          <div className="flex items-baseline gap-1">
            <span className="font-display text-[clamp(64px,10vw,104px)] font-extrabold leading-[0.85] tracking-[-0.05em]" style={{ color: accent }}>{pct}</span>
            <span className="font-serif text-[clamp(30px,5vw,46px)] italic text-[#9C9C9C]">%</span>
          </div>
          <p className="mt-2 text-sm text-[#5C5C5C]">{doneCount} de {PHASES.length} fases completadas</p>
          <div className="mt-4 h-2.5 w-full overflow-hidden rounded-full bg-[#EDEDEA]">
            <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: accent }} />
          </div>
        </div>
      </div>

      {/* Phases — horizontal grid */}
      <div className="mt-14 grid gap-4 sm:grid-cols-2">
        {PHASES.map((p, i) => {
          const st = status[i];
          const active = st === "in_progress";
          const done = st === "done";
          return (
            <div
              key={p.key}
              className="group relative flex gap-4 rounded-2xl border bg-white p-5 transition-all"
              style={{
                borderColor: done ? hexToRgba("#10b981", 0.35) : active ? hexToRgba(accent, 0.35) : "#ECECE8",
                boxShadow: active ? `0 10px 30px ${hexToRgba(accent, 0.12)}` : "0 1px 2px rgba(10,10,10,0.03)",
              }}
            >
              <div
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl font-display text-[15px] font-bold"
                style={
                  done ? { background: "#10b981", color: "#fff" }
                    : active ? { background: accent, color: "#fff" }
                    : { background: "#F1F1EE", color: "#9C9C9C" }
                }
              >
                {done ? <Check className="h-5 w-5" /> : i + 1}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-display text-[17px] font-bold leading-tight tracking-[-0.01em]">{p.title}</h3>
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${PILL[st]}`}>{PILL_LABEL[st]}</span>
                </div>
                <p className="mt-1.5 text-[13px] leading-relaxed text-[#7A7A7A]">{p.description}</p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-12 flex flex-col items-center gap-2">
        <a href="/dashboard" className="inline-flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold text-white shadow-sm transition-transform active:scale-[0.99]" style={{ background: accent }}>
          Ir a mi plataforma <ArrowUpRight className="h-4 w-4" />
        </a>
        <p className="text-[11px] text-[#9C9C9C]">Con tu logo y tus colores, todo en un mismo acceso.</p>
      </div>
    </div>
  );
}
