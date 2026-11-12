import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Brain,
  Check,
  HeartHandshake,
  Inbox,
  LayoutDashboard,
  Lock,
  Mail,
  Send,
  Sparkles,
  Users,
  Zap,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useProfile } from "@/contexts/ProfileContext";
import { useAgencyBrand } from "@/hooks/useAgencyBrand";
import { isImpersonating } from "@/lib/impersonation";
import { brandBarHsl } from "@/lib/brandColor";
import { cn } from "@/lib/utils";
import { CoBrand, HEX6, type BrandSide } from "./CoBrand";

/* Bienvenida de la cuenta de un cliente (12-11-2026): la primera vez que entra, "Bienvenido a
   <agencia>" con el logo y los colores de la agencia, su propio logo al lado, un mini tutorial de
   las secciones que tiene abiertas y el compromiso de la agencia. Se ve UNA vez (se guarda en su
   cuenta, así no se repite en otro dispositivo) y puede volver a abrirse desde su menú. Nunca sale
   cuando el equipo entra a mirar la cuenta del cliente. */

export const CLIENT_WELCOME_EVENT = "fl:client-welcome";
const META_KEY = "client_welcome_v1";
const lsKey = (uid: string) => `fl_${META_KEY}_${uid}`;

type Section = { route: string; label: string; text: string; icon: typeof Send };

/** Las secciones del panel del cliente, en el orden en que se le explican. */
export const WELCOME_SECTIONS: Section[] = [
  { route: "/dashboard", label: "Dashboard", text: "Tus cifras de un vistazo: leads, envíos, respuestas y reuniones.", icon: LayoutDashboard },
  { route: "/campaigns", label: "Campañas", text: "Crea tus campañas, escribe la secuencia y sigue cada envío en directo.", icon: Send },
  { route: "/email-accounts", label: "Cuentas de email", text: "Conecta tus buzones y mira su estado y su envío diario.", icon: Mail },
  { route: "/leads", label: "Leads", text: "Sube tus listas de contactos y tenlas siempre ordenadas.", icon: Users },
  { route: "/unibox", label: "Unibox", text: "Todas las respuestas en un solo sitio, y respondes desde aquí mismo.", icon: Inbox },
  { route: "/stats", label: "Estadísticas", text: "Cómo evolucionan tus envíos y respuestas, día a día.", icon: BarChart3 },
  { route: "/ai-prompts", label: "IA", text: "Agentes que clasifican y te ayudan a contestar a tus leads.", icon: Brain },
];

export function sectionsFor(allowed: string[] | null | undefined): Section[] {
  if (!allowed || allowed.length === 0) return WELCOME_SECTIONS;
  return WELCOME_SECTIONS.filter((s) => allowed.includes(s.route));
}

/** ¿Le toca la bienvenida? Sólo a cuentas de cliente, sin haberla visto y sin ser el equipo mirando. */
export function shouldShowClientWelcome(o: { clientLogin: boolean; impersonating: boolean; seenMeta: boolean; seenLocal: boolean }): boolean {
  return o.clientLogin && !o.impersonating && !o.seenMeta && !o.seenLocal;
}

function heroColors(agency: BrandSide | null, client: BrandSide) {
  const hex = (agency?.color && HEX6.test(agency.color) ? agency.color : null) || (client.color && HEX6.test(client.color) ? client.color : null) || "#6E58F1";
  const bar = brandBarHsl(hex);
  const dark = bar ? `hsl(${bar.h} ${bar.s}% ${bar.l}%)` : "#3B2BD9";
  const deep = bar ? `hsl(${bar.h} ${bar.s}% ${Math.max(bar.l - 14, 8)}%)` : "#241a8f";
  return { hex, dark, deep };
}

export function ClientWelcome() {
  const { user } = useAuth();
  const { profile } = useProfile();
  const navigate = useNavigate();
  const agency = useAgencyBrand();
  const clientLogin = !!profile.client_login_of;
  const [open, setOpen] = useState(false);

  const client: BrandSide = useMemo(() => ({
    name: profile.company_name?.trim() || profile.full_name?.trim() || "Tu empresa",
    logo: profile.logo_url || null,
    color: profile.brand_color && HEX6.test(profile.brand_color) ? profile.brand_color : null,
  }), [profile.company_name, profile.full_name, profile.logo_url, profile.brand_color]);

  const sections = useMemo(() => sectionsFor(profile.allowed_routes), [profile.allowed_routes]);
  const firstName = (profile.full_name || "").trim().split(/\s+/)[0] || "";

  // ¿Primera vez?
  useEffect(() => {
    if (!user || !clientLogin) return;
    let seenLocal = false;
    try { seenLocal = !!localStorage.getItem(lsKey(user.id)); } catch { /* sin almacenamiento */ }
    const seenMeta = !!(user.user_metadata as Record<string, unknown> | undefined)?.[META_KEY];
    if (shouldShowClientWelcome({ clientLogin, impersonating: isImpersonating(), seenMeta, seenLocal })) {
      // Un instante, para que el panel se pinte detrás y la entrada se note.
      const t = window.setTimeout(() => setOpen(true), 450);
      return () => window.clearTimeout(t);
    }
  }, [user, clientLogin]);

  // Volver a verla desde el menú de la cuenta.
  useEffect(() => {
    const abrir = () => setOpen(true);
    window.addEventListener(CLIENT_WELCOME_EVENT, abrir);
    return () => window.removeEventListener(CLIENT_WELCOME_EVENT, abrir);
  }, []);

  const marcarVista = useCallback(() => {
    if (!user) return;
    try { localStorage.setItem(lsKey(user.id), new Date().toISOString()); } catch { /* sin almacenamiento */ }
    if (!isImpersonating() && !(user.user_metadata as Record<string, unknown> | undefined)?.[META_KEY]) {
      void supabase.auth.updateUser({ data: { [META_KEY]: new Date().toISOString() } }).catch(() => {});
    }
  }, [user]);

  const cerrar = (destino?: string) => {
    marcarVista();
    setOpen(false);
    if (destino) navigate(destino);
  };

  if (!clientLogin) return null;
  return <WelcomeView open={open} onClose={cerrar} agency={agency} client={client} sections={sections} firstName={firstName} />;
}

/** La bienvenida en sí (sin datos de sesión): se prueba y se ve suelta. */
export function WelcomeView({
  open,
  onClose,
  agency,
  client,
  sections,
  firstName,
}: {
  open: boolean;
  onClose: (destino?: string) => void;
  agency: BrandSide | null;
  client: BrandSide;
  sections: Section[];
  firstName: string;
}) {
  const [step, setStep] = useState(0);
  useEffect(() => { if (open) setStep(0); }, [open]);
  const agencyName = agency?.name || "tu agencia";
  const c = heroColors(agency, client);
  const cerrar = onClose;
  const STEPS = 3;
  const last = step === STEPS - 1;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) cerrar(); }}>
      <DialogContent
        className="force-light max-h-[94dvh] w-[calc(100vw-24px)] max-w-[620px] gap-0 overflow-y-auto overflow-x-hidden rounded-[28px] border-0 bg-white p-0 shadow-[0_40px_90px_-30px_rgba(15,10,60,.55)] sm:rounded-[28px] [&>button]:right-4 [&>button]:top-4 [&>button]:z-20 [&>button]:rounded-full [&>button]:bg-white/20 [&>button]:p-1.5 [&>button]:text-white [&>button]:opacity-100 [&>button]:hover:bg-white/30"
        data-client-welcome=""
      >
        {/* Cabecera con los colores de la agencia */}
        <div className="relative overflow-hidden px-6 pb-7 pt-8 text-white sm:px-9 sm:pt-10" style={{ background: `linear-gradient(140deg, ${c.deep} 0%, ${c.dark} 48%, ${c.hex} 100%)` }}>
          <span aria-hidden="true" className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-white/10 blur-2xl" />
          <span aria-hidden="true" className="pointer-events-none absolute -bottom-24 -left-10 h-56 w-56 rounded-full bg-white/10 blur-2xl" />
          <svg aria-hidden="true" viewBox="0 0 600 120" preserveAspectRatio="none" className="pointer-events-none absolute inset-x-0 bottom-0 h-16 w-full opacity-30">
            <path d="M0 90 C 120 40, 220 120, 340 70 S 520 20, 600 60 L600 120 L0 120 Z" fill="white" fillOpacity=".18" />
            <path d="M0 105 C 140 70, 260 125, 380 90 S 540 60, 600 85" stroke="white" strokeOpacity=".5" strokeWidth="1.5" fill="none" />
          </svg>

          <div className="relative flex justify-center">
            <div className="cw-pop">
              <CoBrand agency={agency} client={client} size="hero" />
            </div>
          </div>

          <div className="relative mt-6 text-center">
            {step === 0 && (
              <>
                <p className="text-[12.5px] font-semibold uppercase tracking-[0.14em] text-white/75">{firstName ? `Hola, ${firstName}` : "Hola"}</p>
                <DialogTitle className="mt-1.5 font-display text-[clamp(26px,5vw,34px)] font-semibold leading-[1.1] tracking-[-0.03em] text-white">
                  Bienvenido a {agencyName}
                </DialogTitle>
                <DialogDescription className="mx-auto mt-2.5 max-w-[440px] text-[15px] leading-relaxed text-white/85">
                  Hemos preparado este panel para <b className="font-semibold text-white">{client.name}</b>. Aquí vas a ver tus campañas, tus respuestas y tus resultados en tiempo real.
                </DialogDescription>
              </>
            )}
            {step === 1 && (
              <>
                <p className="text-[12.5px] font-semibold uppercase tracking-[0.14em] text-white/75">Mini tutorial</p>
                <DialogTitle className="mt-1.5 font-display text-[clamp(24px,4.5vw,30px)] font-semibold leading-[1.15] tracking-[-0.03em] text-white">
                  Tu panel, en un minuto
                </DialogTitle>
                <DialogDescription className="mx-auto mt-2 max-w-[440px] text-[14.5px] leading-relaxed text-white/85">
                  Esto es lo que tienes a mano. Pulsa cualquiera para ir directo.
                </DialogDescription>
              </>
            )}
            {step === 2 && (
              <>
                <p className="text-[12.5px] font-semibold uppercase tracking-[0.14em] text-white/75">Nuestro compromiso</p>
                <DialogTitle className="mt-1.5 font-display text-[clamp(24px,4.5vw,30px)] font-semibold leading-[1.15] tracking-[-0.03em] text-white">
                  Vamos a darte el mejor servicio
                </DialogTitle>
                <DialogDescription className="mx-auto mt-2 max-w-[460px] text-[14.5px] leading-relaxed text-white/85">
                  El equipo de {agencyName} está contigo en cada campaña. Cualquier cosa que necesites, nos lo dices.
                </DialogDescription>
              </>
            )}
          </div>
        </div>

        {/* Contenido del paso */}
        <div className="px-5 pb-5 pt-5 sm:px-8 sm:pb-7">
          <div key={step} className="cw-step">
            {step === 0 && (
              <ul className="grid gap-2.5 sm:grid-cols-3">
                {[
                  { icon: Zap, t: "Todo en directo", d: "Envíos y respuestas al momento." },
                  { icon: Sparkles, t: "Con tu marca", d: `Tu logo y tus colores, ${client.name}.` },
                  { icon: Lock, t: "Tus datos, solo tuyos", d: "Nadie más ve tu información." },
                ].map(({ icon: Icon, t, d }) => (
                  <li key={t} className="rounded-2xl border border-[#ECEAF6] bg-[#FBFAFF] p-3.5">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: `${c.hex}1a`, color: c.dark }}>
                      <Icon className="h-[18px] w-[18px]" />
                    </span>
                    <p className="mt-2.5 text-[14px] font-semibold text-[#0b1040]">{t}</p>
                    <p className="mt-0.5 text-[12.5px] leading-snug text-[#6470a8]">{d}</p>
                  </li>
                ))}
              </ul>
            )}

            {step === 1 && (
              <ul className="grid gap-2 sm:grid-cols-2">
                {sections.map(({ route, label, text, icon: Icon }, i) => (
                  <li key={route} className="cw-item" style={{ animationDelay: `${i * 60}ms` }}>
                    <button
                      type="button"
                      onClick={() => cerrar(route)}
                      className="group flex h-full w-full items-start gap-3 rounded-2xl border border-[#ECEAF6] bg-white p-3 text-left transition-all hover:-translate-y-0.5 hover:shadow-[0_12px_24px_-16px_rgba(16,24,64,.45)]"
                      style={{ ["--cw" as string]: c.hex }}
                    >
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white shadow-sm" style={{ background: `linear-gradient(135deg, ${c.hex}, ${c.dark})` }}>
                        <Icon className="h-[18px] w-[18px]" />
                      </span>
                      <span className="min-w-0">
                        <span className="flex items-center gap-1 text-[14px] font-semibold text-[#0b1040]">
                          {label}
                          <ArrowRight className="h-3.5 w-3.5 -translate-x-1 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" style={{ color: c.dark }} />
                        </span>
                        <span className="mt-0.5 block text-[12.5px] leading-snug text-[#6470a8]">{text}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {step === 2 && (
              <div className="space-y-2.5">
                {[
                  { icon: HeartHandshake, t: "Te acompañamos en cada paso", d: `Preparamos y cuidamos tus campañas contigo, para que cada envío cuente.` },
                  { icon: Inbox, t: "No se te escapa ninguna respuesta", d: "Cada lead que contesta aparece en tu Unibox al momento." },
                  { icon: BarChart3, t: "Resultados claros", d: "Siempre sabrás qué funciona y cuántas reuniones salen." },
                ].map(({ icon: Icon, t, d }) => (
                  <div key={t} className="flex items-start gap-3 rounded-2xl border border-[#ECEAF6] bg-[#FBFAFF] p-3.5">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white" style={{ background: c.dark }}>
                      <Icon className="h-[17px] w-[17px]" />
                    </span>
                    <div>
                      <p className="text-[14px] font-semibold text-[#0b1040]">{t}</p>
                      <p className="mt-0.5 text-[12.5px] leading-snug text-[#6470a8]">{d}</p>
                    </div>
                  </div>
                ))}
                <p className="pt-1 text-center text-[13px] text-[#6470a8]">
                  Gracias por confiar en <b className="font-semibold" style={{ color: c.dark }}>{agencyName}</b>.
                </p>
              </div>
            )}
          </div>

          {/* Pie: progreso y botones */}
          <div className="mt-5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5" aria-label={`Paso ${step + 1} de ${STEPS}`}>
              {Array.from({ length: STEPS }).map((_, i) => (
                <span key={i} className="h-2 rounded-full transition-all duration-300" style={{ width: i === step ? 22 : 8, background: i <= step ? c.hex : "#E4E2F0" }} />
              ))}
            </div>
            <div className="flex items-center gap-2">
              {step > 0 ? (
                <button type="button" onClick={() => setStep((s) => s - 1)} className="inline-flex h-11 items-center gap-1.5 rounded-xl px-3.5 text-[14px] font-medium text-[#3b3f6b] hover:bg-[#F4F3FA]">
                  <ArrowLeft className="h-4 w-4" /> Atrás
                </button>
              ) : (
                <button type="button" onClick={() => cerrar()} className="inline-flex h-11 items-center rounded-xl px-3.5 text-[14px] font-medium text-[#6470a8] hover:bg-[#F4F3FA]">
                  Saltar
                </button>
              )}
              <button
                type="button"
                onClick={() => (last ? cerrar() : setStep((s) => s + 1))}
                className="inline-flex h-11 items-center gap-2 rounded-xl px-5 text-[14.5px] font-semibold text-white shadow-[0_10px_22px_-10px_rgba(16,24,64,.6)] transition hover:brightness-110 active:scale-[.98]"
                style={{ background: `linear-gradient(135deg, ${c.hex}, ${c.dark})` }}
              >
                {last ? <>Empezar <Check className="h-4 w-4" strokeWidth={2.5} /></> : step === 0 ? <>Ver mi panel <ArrowRight className="h-4 w-4" /></> : <>Siguiente <ArrowRight className="h-4 w-4" /></>}
              </button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default ClientWelcome;
