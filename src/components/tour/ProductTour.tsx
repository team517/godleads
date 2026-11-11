import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { MousePointerClick, Play } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { useWelcomeGate } from "@/hooks/useWelcomeGate";
import { useTourState } from "@/hooks/useTourState";
import { stateMatchesUser, useImpersonation } from "@/lib/impersonation";
import { OPEN_TOUR_EVENT, TOUR_STEPS, shouldOfferTour, tourMinutes } from "@/lib/tour";
import { FunnyGuide } from "./FunnyGuide";

/* Tutorial guiado (11-11-2026). Una vez dentro del panel, a una cuenta nueva con suscripción se le
 * pregunta UNA vez si quiere el recorrido. "Sí" → Funny la guía por su cuenta real (y queda apuntado
 * como visto).
 * "Ahora no" → apuntado como saltado, no vuelve a salir. Desde el menú de la cuenta se puede ver
 * otra vez cuando se quiera, sin tocar lo guardado. */

const GuidedTour = lazy(() => import("./GuidedTour"));

/** Lo que tarda en salir la pregunta, para que la página termine de pintarse antes. */
export const OFFER_DELAY_MS = 1500;

export function TourOffer({ open, onYes, onNo }: { open: boolean; onYes: () => void; onNo: () => void }) {
  const minutes = tourMinutes();
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onNo(); }}>
      <DialogContent className="max-w-[440px] overflow-hidden p-0">
        <div className="relative bg-gradient-to-br from-[#3B2BD9] via-[#6E58F1] to-[#8B6BFF] px-6 pb-6 pt-7 text-white">
          <span className="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-white/10 blur-2xl" aria-hidden="true" />
          <div className="relative flex items-center gap-3">
            <FunnyGuide size={52} />
            <span className="flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-[12px] font-semibold"><MousePointerClick className="h-3.5 w-3.5" /> Mini tutorial · {minutes} min</span>
          </div>
          <DialogTitle className="relative mt-4 font-display text-[24px] font-semibold leading-tight tracking-[-0.03em] text-white">
            ¿Te enseñamos Funnyleads en {minutes} minutos?
          </DialogTitle>
          <DialogDescription className="relative mt-1.5 text-[14px] leading-relaxed text-white/85">
            Soy Funny. Te llevo por tu propia cuenta: el cursor va a cada sección, te señalo lo importante y te lo explico. Puedes pausarlo o saltarlo cuando quieras.
          </DialogDescription>
        </div>
        <div className="px-6 pb-6 pt-4">
          <div className="flex flex-wrap gap-1.5">
            {TOUR_STEPS.filter((c) => c.id !== "hola" && c.id !== "fin").map((c) => (
              <span key={c.id} className="rounded-full bg-secondary px-2.5 py-1 text-[12px] font-medium text-secondary-foreground">{c.short}</span>
            ))}
          </div>
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={onNo}
              className="rounded-md px-4 py-2.5 text-[14px] font-semibold text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
              Ahora no
            </button>
            <button type="button" onClick={onYes} autoFocus
              className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-5 py-2.5 text-[14px] font-semibold text-white shadow-[0_2px_4px_rgba(110,88,241,.24)] transition-colors hover:bg-[#5B40FB]">
              <Play className="h-4 w-4" /> Sí, enséñamelo
            </button>
          </div>
          <p className="mt-3 text-center text-[12px] text-muted-foreground sm:text-right">Siempre podrás verlo desde el menú de tu cuenta.</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ProductTour() {
  const { user } = useAuth();
  const { status } = useSubscription();
  const welcome = useWelcomeGate();
  const impersonation = useImpersonation();
  const { pathname } = useLocation();
  const tour = useTourState(user?.id);
  const [offer, setOffer] = useState(false);
  const [playing, setPlaying] = useState(false);

  const eligible = shouldOfferTour({
    subscriptionStatus: status,
    stateLoaded: tour.loaded,
    tourState: tour.state,
    welcomeDone: welcome === "done",
    impersonating: stateMatchesUser(impersonation, user?.id),
    pathname,
  });

  useEffect(() => {
    if (!eligible) { setOffer(false); return; }
    const id = window.setTimeout(() => setOffer(true), OFFER_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [eligible]);

  // "Ver el tutorial" desde el menú de la cuenta.
  useEffect(() => {
    const open = () => { setOffer(false); setPlaying(true); };
    window.addEventListener(OPEN_TOUR_EVENT, open);
    return () => window.removeEventListener(OPEN_TOUR_EVENT, open);
  }, []);

  const yes = useCallback(() => { setOffer(false); setPlaying(true); void tour.save("done"); }, [tour]);
  const no = useCallback(() => { setOffer(false); void tour.save("skipped"); }, [tour]);

  return (
    <>
      <TourOffer open={offer && eligible} onYes={yes} onNo={no} />
      {playing && (
        <Suspense fallback={null}>
          <GuidedTour onClose={() => setPlaying(false)} />
        </Suspense>
      )}
    </>
  );
}
