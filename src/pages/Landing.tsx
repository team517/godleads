import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { destinoChoose, landingIsPainted, landingTarget, textoDeTarjeta } from "@/lib/landing-links";
import { LandingCustomPlan } from "@/components/pricing/LandingCustomPlan";
import { useAuth } from "@/contexts/AuthContext";
import { useSubscription } from "@/contexts/SubscriptionContext";

/* =============================================================================
   Landing pública: Funnyleads desde el 10-11-2026 (antes la de OnePulso, que sigue en /landing/onepulso-landing.html).

   Es el archivo que exporta Claude Design (`public/landing/onepulso-landing.html`), servido
   TAL CUAL: no se toca ni un byte, así que lo que se ve es exactamente el diseño del
   propietario. Ese archivo es una página autocontenida que se desempaqueta sola y sustituye
   su propio documento, por eso vive en un marco a pantalla completa en vez de incrustarse.

   Lo único que se añade desde FUERA:
   · el destino de sus botones: en el diseño apuntan a anclas de maqueta (#login, #signup,
     #demo…) y aquí llevan al acceso real. Las anclas de sección siguen desplazando la página.
   · la espera: mientras se desempaqueta, el archivo pinta una pantalla entera de color violeta
     (su "miniatura" de carga). El marco se mantiene oculto hasta que la página de verdad está
     pintada, y entretanto se ve el fondo claro de la propia landing con la marca.

   Para cambiar la landing: ver scripts/build-landing.mjs y subir LANDING_VERSION.
   ========================================================================== */

const LANDING_VERSION = "2026-11-10";
// Landing de Funnyleads (diseño de Claude Design servido tal cual; ver scripts/build-landing.mjs).
const LANDING_SRC = `/landing/funnyleads/index.html?v=${LANDING_VERSION}`;
/** Si algo impide detectar que está lista, se enseña igualmente pasado este tiempo. */
const SHOW_ANYWAY_MS = 12000;

export default function Landing() {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const { user } = useAuth();
  const { subscribed } = useSubscription();
  // Plan a medida (11-11-2026): quien ya tiene plan lo cambia en Ajustes → Plan; el resto, al alta.
  const elegirAMedida = useCallback((level: number, interval: "month" | "year") => {
    if (user && subscribed) navigate("/settings?tab=plan");
    else navigate(`/empezar?plan=custom&nivel=${level}&periodo=${interval}`);
  }, [user, subscribed, navigate]);

  useEffect(() => {
    const prev = document.title;
    document.title = "Funnyleads — Turn cold email into booked revenue";
    return () => { document.title = prev; };
  }, []);

  // La landing es un diseño en claro: con el modo oscuro del navegador, el chat flotante del
  // visitante salía oscuro sobre la página blanca (11-11-2026). Mientras está abierta, en claro.
  useEffect(() => {
    const root = document.documentElement;
    const eraOscuro = root.classList.contains("dark");
    root.classList.remove("dark");
    return () => { if (eraOscuro) root.classList.add("dark"); };
  }, []);

  // Vigila el documento del marco hasta que la página real está pintada.
  useEffect(() => {
    if (ready) return;
    const started = Date.now();
    const t = window.setInterval(() => {
      let painted = false;
      try { painted = landingIsPainted(frameRef.current?.contentDocument); } catch { /* aún sin acceso */ }
      if (painted || Date.now() - started > SHOW_ANYWAY_MS) { window.clearInterval(t); setReady(true); }
    }, 80);
    return () => window.clearInterval(t);
  }, [ready]);

  // El marco es del mismo origen, así que se puede escuchar su documento. El oyente va en el
  // objeto Document (no en <html>, que la página sustituye al desempaquetarse) y en captura,
  // para decidir antes que el propio enlace.
  const wire = useCallback(() => {
    const doc = frameRef.current?.contentDocument;
    if (!doc || (doc as any).__opWired) return;
    (doc as any).__opWired = true;
    doc.addEventListener("click", (e) => {
      if (e.defaultPrevented || (e as MouseEvent).button !== 0) return;
      const a = (e.target as Element | null)?.closest?.("a[href]");
      const href = a?.getAttribute("href");
      // "Choose" de una tarjeta de precio → pago de ese plan (mensual o anual según la tarjeta).
      const target = (href?.trim().toLowerCase() === "#signup" && destinoChoose(textoDeTarjeta(a))) || landingTarget(href, a?.textContent);
      if (!target) return;
      e.preventDefault();
      if (target.kind === "route") navigate(target.to);
      else window.location.href = target.to;
    }, true);
  }, [navigate]);

  return (
    <div className="fixed inset-0 bg-[#FBFAFE]">
      {/* Lo esencial de la portada en texto, igual que lo que se ve en el marco: para lectores de
          pantalla y para que Google entienda de qué va la página sin depender del marco. */}
      <section className="sr-only">
        <h1>Funnyleads — Turn cold email into booked revenue</h1>
        <p>Your emails reach the primary inbox instead of spam, and the replies get answered and booked for you. More meetings from the same list, without hiring anyone. 14 days free, cancel anytime.</p>
        <h2>A sending engine built for cold outreach</h2>
        <p>Unlimited mailboxes and warmup, slow ramp handled for you, AI replies drafted the moment they land, one Master Inbox for every reply, and every email sent at 9am in each contact's own timezone. Send from Gmail, Outlook or your own servers.</p>
        <h2>Pricing</h2>
        <p>Starter 21 € per month, Growth 65 € per month, Pack Agency 170 € per month, or a custom plan from 250,000 to 5,000,000 emails per month (99 € to 1,229 € per month). 17% off with yearly billing.</p>
        <p><a href="/auth">Log in</a> · <a href="/auth?mode=signup">Start free trial</a></p>
      </section>
      {/* Espera: el fondo de la propia landing y la marca, nada de pantallas de color. */}
      <div
        aria-hidden={ready}
        className={`absolute inset-0 flex flex-col items-center justify-center gap-5 transition-opacity duration-300 ${ready ? "pointer-events-none opacity-0" : "opacity-100"}`}
      >
        <span className="text-2xl font-semibold tracking-tight text-[#0F172B]" style={{ fontFamily: "Inter, system-ui, sans-serif" }}>Funnyleads</span>
        <span className="block h-[3px] w-28 overflow-hidden rounded-full bg-[#EAE7F4]">
          <span className="skeleton-shimmer block h-full w-full rounded-full [background-image:linear-gradient(90deg,#EAE7F4_0%,#8B6BFF_45%,#EAE7F4_90%)]" />
        </span>
      </div>
      <iframe
        ref={frameRef}
        src={LANDING_SRC}
        title="Funnyleads"
        onLoad={wire}
        className={`absolute inset-0 block h-[100dvh] w-full border-0 bg-[#FBFAFE] transition-opacity duration-500 ${ready ? "opacity-100" : "opacity-0"}`}
      />
      {/* Plan a medida con la barra, dentro del marco bajo la tabla de precios. */}
      <LandingCustomPlan frame={frameRef.current} ready={ready} onChoose={elegirAMedida} />
    </div>
  );
}
