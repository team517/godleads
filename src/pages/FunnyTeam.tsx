import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarCheck, ExternalLink, LineChart, MailCheck, PenLine, Server } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useProfile } from "@/contexts/ProfileContext";
import { TeamAvatars } from "@/components/chatbot/TeamAvatars";

/* Funny Team (11-11-2026): el apartado de los clientes para reservar una reunión con el equipo de
   Funnyleads sin salir de la plataforma. La agenda es la de Cal.com del equipo, incrustada, con el
   nombre y el correo del cliente ya rellenados. */

export const FUNNY_TEAM_BOOKING_URL = "https://cal.com/xavier-falco-hszeeb/15min";

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

export const CAL_LINK = "xavier-falco-hszeeb/15min";
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
    Cal.ns[CAL_NS]("ui", { theme: dark ? "dark" : "light", hideEventTypeDetails: false, layout: "month_view", cssVarsPerTheme: { light: { "cal-brand": "#6E58F1" }, dark: { "cal-brand": "#8B7BFF" } } });
    // Cal.com marca su elemento con loading="done" cuando la agenda ya está pintada; si tardara, a
    // los 12 s se quita el aviso de carga igualmente (la agenda sigue cargando debajo).
    let done = false;
    const ready = () => { if (done) return; done = true; onReady(); obs.disconnect(); clearTimeout(t); };
    const obs = new MutationObserver(() => { if (el.querySelector('cal-inline[loading="done"]')) ready(); });
    obs.observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ["loading"] });
    const t = setTimeout(ready, 12_000);
    return () => { obs.disconnect(); clearTimeout(t); };
  }, [name, email, dark, onReady]);
  return <div ref={ref} className="min-h-[640px] w-full" />;
}

const AYUDA = [
  { icon: PenLine, title: "Copy y secuencias", text: "Revisamos tus correos y te proponemos mensajes que consiguen respuestas." },
  { icon: MailCheck, title: "Entregabilidad", text: "Buzones, warm-up, DNS y límites diarios para llegar a la bandeja principal." },
  { icon: LineChart, title: "Resultados", text: "Analizamos tus campañas contigo y vemos qué cambiar para tener más reuniones." },
  { icon: Server, title: "Configuración", text: "Te ayudamos a conectar cuentas, importar leads y lanzar tu primera campaña." },
];

export default function FunnyTeam() {
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
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6">
      {/* Cabecera */}
      <section className="relative overflow-hidden rounded-[24px] bg-gradient-to-br from-[#3B2BD9] via-[#6E58F1] to-[#4F8BFF] px-6 py-8 text-white shadow-[0_18px_40px_rgba(79,62,230,.25)] sm:px-10">
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-white/10 blur-2xl" aria-hidden="true" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="max-w-xl">
            <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-white/75">Funny Team</p>
            <h1 className="mt-1 font-display text-[30px] font-semibold leading-tight tracking-[-0.03em] sm:text-[36px]">
              Reserva una reunión con tu equipo
            </h1>
            <p className="mt-2 text-[15px] leading-relaxed text-white/85">
              Personas reales que te ayudan con tus campañas. Elige el día y la hora que te vengan bien:
              la reunión es de 15 minutos por videollamada y te llega la invitación al correo.
            </p>
          </div>
          <div className="flex items-center gap-3 rounded-2xl bg-white/12 px-4 py-3 backdrop-blur">
            <TeamAvatars size={44} />
            <div className="text-[13px] leading-tight">
              <p className="font-semibold">Equipo de Funnyleads</p>
              <p className="flex items-center gap-1.5 text-white/80"><span className="h-2 w-2 rounded-full bg-emerald-400" aria-hidden="true" /> Disponible esta semana</p>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        {/* En qué te ayudamos */}
        <section className="space-y-3" aria-labelledby="ayuda-title">
          <h2 id="ayuda-title" className="font-display text-lg font-semibold tracking-[-0.02em] text-foreground">En qué te ayudamos</h2>
          {AYUDA.map(({ icon: Icon, title, text }) => (
            <div key={title} className="flex gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <p className="text-[14px] font-semibold text-foreground">{title}</p>
                <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">{text}</p>
              </div>
            </div>
          ))}
          <p className="px-1 text-[12.5px] text-muted-foreground">
            ¿Prefieres escribir? Abre el chat de abajo a la derecha y elige <b>Habla con nuestro equipo</b>.
          </p>
        </section>

        {/* Agenda */}
        <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm" aria-labelledby="agenda-title">
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <h2 id="agenda-title" className="flex items-center gap-2 text-[14px] font-semibold text-foreground">
              <CalendarCheck className="h-4 w-4 text-primary" aria-hidden="true" /> Elige día y hora
            </h2>
            <a href={FUNNY_TEAM_BOOKING_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12.5px] font-medium text-primary hover:underline">
              Abrir en otra pestaña <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          </div>
          <div className="relative min-h-[640px]">
            {!loaded && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
                <span className="h-8 w-8 animate-spin rounded-full border-2 border-primary/25 border-t-primary" aria-hidden="true" />
                Cargando la agenda…
              </div>
            )}
            <div aria-label="Reservar una reunión con el equipo de Funnyleads" role="region" className="relative">
              <CalInline name={name} email={email} dark={dark} onReady={onReady} />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
