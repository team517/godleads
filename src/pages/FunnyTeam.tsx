import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import { useFunnyTeamAccess } from "@/hooks/useFunnyTeamAccess";
import { ExternalLink, LineChart, MailCheck, PenLine, Server } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useProfile } from "@/contexts/ProfileContext";
import { TeamAvatars } from "@/components/chatbot/TeamAvatars";

/* Funny Team (11-11-2026): el apartado de los clientes para reservar una reunión con el equipo de
   Funnyleads sin salir de la plataforma. La agenda es la de Cal.com del equipo, incrustada, con el
   nombre y el correo del cliente ya rellenados. */

export const FUNNY_TEAM_BOOKING_URL = "https://cal.com/xavier-falco-hszeeb/funny-team";

/** URL de la agenda incrustada, con nombre y correo prefijados y el tema de la plataforma. Pura. */
export function bookingEmbedUrl(opts: { name?: string | null; email?: string | null; dark?: boolean }): string {
  const u = new URL(FUNNY_TEAM_BOOKING_URL);
  u.searchParams.set("embed", "true");
  u.searchParams.set("layout", "month_view");
  u.searchParams.set("theme", opts.dark ? "dark" : "light");
  if (opts.name && opts.name.trim()) u.searchParams.set("name", opts.name.trim());
  if (opts.email && opts.email.trim()) u.searchParams.set("email", opts.email.trim());
  return u.toString();
}

export const CAL_LINK = "xavier-falco-hszeeb/funny-team";
const CAL_EMBED_SCRIPT = "https://app.cal.com/embed/embed.js";
const CAL_NS = "funnyteam";

/** Carga la integración oficial de Cal.com (el mismo fragmento que da Cal.com para "Inline embed"). */
function ensureCal(): any {
  const w = window as any;
  if (!w.Cal) {
    const q = (api: any, args: any) => { api.q.push(args); };
    const cal: any = function (...args: any[]) {
      if (!cal.loaded) {
        cal.ns = {}; cal.q = cal.q || [];
        const sc = document.createElement("script"); sc.src = CAL_EMBED_SCRIPT; sc.async = true;
        document.head.appendChild(sc);
        cal.loaded = true;
      }
      if (args[0] === "init") {
        const api: any = function (...a: any[]) { q(api, a); };
        api.q = api.q || [];
        const namespace = args[1];
        if (typeof namespace === "string") {
          cal.ns[namespace] = cal.ns[namespace] || api;
          q(cal.ns[namespace], args);
          q(cal, ["initNamespace", namespace]);
        } else q(cal, args);
        return;
      }
      q(cal, args);
    };
    cal.q = [];
    w.Cal = cal;
  }
  return w.Cal;
}

/** La agenda incrustada con la integración oficial: sin marcos en blanco y con la altura justa. */
function CalInline({ name, email, dark, onReady }: { name: string; email: string; dark: boolean; onReady: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = "";
    const id = `cal-inline-${Math.random().toString(36).slice(2, 8)}`;
    el.id = id;
    const Cal = ensureCal();
    if (!Cal.ns?.[CAL_NS]) Cal("init", CAL_NS, { origin: "https://cal.com" });
    const config: Record<string, string> = { layout: "month_view", theme: dark ? "dark" : "light" };
    if (name.trim()) config.name = name.trim();
    if (email.trim()) config.email = email.trim();
    Cal.ns[CAL_NS]("inline", { elementOrSelector: `#${id}`, calLink: CAL_LINK, config });
    // En móvil, sin la ficha del evento (la cabecera ya lo cuenta): el calendario sale antes.
    const movil = typeof window !== "undefined" && window.innerWidth < 768;
    Cal.ns[CAL_NS]("ui", { theme: dark ? "dark" : "light", hideEventTypeDetails: movil, layout: "month_view", cssVarsPerTheme: { light: { "cal-brand": "#6E58F1" }, dark: { "cal-brand": "#8B7BFF" } } });
    // Cal.com marca su elemento con loading="done" cuando la agenda ya está pintada; si tardara, a
    // los 12 s se quita el aviso de carga igualmente (la agenda sigue cargando debajo).
    let done = false;
    const ready = () => { if (done) return; done = true; onReady(); obs.disconnect(); clearTimeout(t); };
    const obs = new MutationObserver(() => { if (el.querySelector('cal-inline[loading="done"]')) ready(); });
    obs.observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ["loading"] });
    const t = setTimeout(ready, 12_000);
    return () => { obs.disconnect(); clearTimeout(t); };
  }, [name, email, dark, onReady]);
  return <div ref={ref} className="min-h-[460px] w-full" />;
}

const AYUDA = [
  { icon: PenLine, title: "Copy y secuencias", text: "Revisamos tus correos y te proponemos mensajes que consiguen respuestas." },
  { icon: MailCheck, title: "Entregabilidad", text: "Buzones, warm-up, DNS y límites diarios para llegar a la bandeja principal." },
  { icon: LineChart, title: "Resultados", text: "Analizamos tus campañas contigo y vemos qué cambiar para tener más reuniones." },
  { icon: Server, title: "Configuración", text: "Te ayudamos a conectar cuentas, importar leads y lanzar tu primera campaña." },
];

export default function FunnyTeam() {
  const access = useFunnyTeamAccess();
  // Sólo clientes nuevos con suscripción (y el equipo): los del portal de la agencia vuelven al inicio.
  if (!access.loading && !access.allowed) return <Navigate to="/" replace />;
  return <FunnyTeamView />;
}

/** La página (sin la comprobación de acceso). 11-11-2026: la agenda a todo el ancho para que Cal.com
 *  enseñe el mes y las horas lado a lado sin barra interna; la ayuda, en una fila debajo. */
export function FunnyTeamView() {
  const { user } = useAuth();
  const { profile } = useProfile();
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const prev = document.title;
    document.title = "Funny Team · Funnyleads";
    const obs = new MutationObserver(() => setDark(document.documentElement.classList.contains("dark")));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => { document.title = prev; obs.disconnect(); };
  }, []);

  const name = (profile as { full_name?: string | null } | null)?.full_name || "";
  const email = (profile as { contact_email?: string | null } | null)?.contact_email || user?.email || "";
  const onReady = useMemo(() => () => setLoaded(true), []);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-3 px-4 pb-5 pt-3 sm:px-6">
      {/* Cabecera compacta: así la agenda entera cabe en la pantalla */}
      <section className="relative overflow-hidden rounded-[20px] bg-gradient-to-br from-[#3B2BD9] via-[#6E58F1] to-[#4F8BFF] px-5 py-3.5 text-white shadow-[0_14px_32px_rgba(79,62,230,.22)] sm:px-7">
        <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-white/10 blur-2xl" aria-hidden="true" />
        <div className="relative flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <h1 className="font-display text-[22px] font-semibold leading-tight tracking-[-0.03em] sm:text-[26px]">
              Reserva una reunión con tu equipo
            </h1>
            <p className="mt-1 text-[13.5px] leading-relaxed text-white/85 sm:text-[14.5px]">
              15 minutos por Google Meet con personas reales. Elige día y hora, déjanos una nota y te llega la invitación al correo.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-3">
            <div className="flex items-center gap-2.5 rounded-2xl bg-white/12 px-3 py-2 backdrop-blur">
              <TeamAvatars size={34} />
              <div className="text-[12.5px] leading-tight">
                <p className="font-semibold">Funny Team</p>
                <p className="flex items-center gap-1.5 text-white/80"><span className="h-2 w-2 rounded-full bg-emerald-400" aria-hidden="true" /> Disponible esta semana</p>
              </div>
            </div>
            <a href={FUNNY_TEAM_BOOKING_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-xl px-2 py-1.5 text-[12.5px] font-medium text-white/90 hover:bg-white/10 hover:text-white">
              Abrir en otra pestaña <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          </div>
        </div>
      </section>

      {/* Agenda (a todo el ancho: Cal.com pone el mes y las horas lado a lado) */}
      <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm" aria-label="Elige día y hora">
        <div className="relative min-h-[460px]">
          {!loaded && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
              <span className="h-8 w-8 animate-spin rounded-full border-2 border-primary/25 border-t-primary" aria-hidden="true" />
              Cargando la agenda…
            </div>
          )}
          <div aria-label="Reservar una reunión con el equipo de Funnyleads" role="region" className={loaded ? "relative opacity-100 transition-opacity duration-300" : "relative opacity-0"}>
            <CalInline name={name} email={email} dark={dark} onReady={onReady} />
          </div>
        </div>
      </section>

      {/* En qué te ayudamos */}
      <section aria-labelledby="ayuda-title">
        <h2 id="ayuda-title" className="mb-3 font-display text-[17px] font-semibold tracking-[-0.02em] text-foreground">En qué te ayudamos</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {AYUDA.map(({ icon: Icon, title, text }) => (
            <div key={title} className="flex gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm transition-shadow hover:shadow-md">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <p className="text-[14px] font-semibold text-foreground">{title}</p>
                <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">{text}</p>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 px-1 text-[12.5px] text-muted-foreground">
          ¿Prefieres escribir? Abre el chat de abajo a la derecha y elige <b>Habla con nuestro equipo</b>.
        </p>
      </section>
    </div>
  );
}
