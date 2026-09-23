import { useEffect, useState } from "react";
import { Bell, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { isPushSupported, getPushPermission, subscribeToPush } from "@/lib/push-notifications";
import { isIosDevice, pushOfferState, type PushOffer } from "@/lib/push-offer";

const SNOOZE_KEY = "push-prompt-snoozed-until";
const SNOOZE_DAYS = 7;

/** True when the app is running from the home-screen shortcut rather than a browser tab.
 *  iOS reports it on `navigator.standalone`; everyone else via the display-mode media query. */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    window.matchMedia?.("(display-mode: minimal-ui)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

/**
 * Ofrece al cliente activar los avisos de interesados y preguntas.
 *
 * Sale donde puede funcionar: en el navegador (ordenador y Android) y en la app instalada. En
 * iPhone dentro de una pestaña no se puede suscribir, así que en vez de callarse explica cómo
 * instalarla. Quien lo cierra no lo vuelve a ver en una semana, y a quien ya los tiene (o los
 * ha bloqueado en el navegador) no se le molesta. La decisión está en pushOfferState.
 */
export function PushPrompt() {
  const { user } = useAuth();
  const [offer, setOffer] = useState<PushOffer>("hidden");
  const [busy, setBusy] = useState(false);
  const show = offer !== "hidden";

  useEffect(() => {
    if (!user) return;
    let alive = true;
    const supported = isPushSupported();
    const ios = isIosDevice(navigator.userAgent, navigator.maxTouchPoints || 0);
    const snoozedUntil = Number(localStorage.getItem(SNOOZE_KEY) || 0);
    // La decisión vive en pushOfferState (probada aparte): ofrecer también en el navegador, no
    // sólo con la app instalada — así lo ve cualquier cliente, no sólo quien la instaló.
    const decide = (perm: NotificationPermission | "unknown") => {
      const next = pushOfferState({ supported, permission: perm, standalone: isStandalone(), isIos: ios, snoozedUntil });
      if (alive && next !== "hidden") setTimeout(() => alive && setOffer(next), 1500);
    };
    if (supported) getPushPermission().then(decide);
    else decide("unknown");
    return () => { alive = false; };
  }, [user]);

  const snooze = () => {
    localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_DAYS * 86400_000));
    setOffer("hidden");
  };

  const enable = async () => {
    if (!user) return;
    setBusy(true);
    try {
      const ok = await subscribeToPush(user.id);
      if (ok) {
        toast.success("Avisos activados — te avisamos de cada interesado y de cada pregunta");
        setOffer("hidden");
      } else {
        // Permission denied, or the browser refused the subscription.
        toast.error("No se pudieron activar. Revisa los permisos de notificaciones del navegador.");
        snooze();
      }
    } catch {
      toast.error("No se pudieron activar ahora mismo. Inténtalo de nuevo más tarde.");
    }
    setBusy(false);
  };

  if (!show) return null;

  // On phones it sits ABOVE the bottom nav (h-14 + safe area) so it never covers it.
  return (
    <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-[60] p-3 md:inset-x-auto md:right-4 md:bottom-4 md:max-w-sm">
      <div className="rounded-2xl border border-border bg-card p-4 shadow-xl">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Bell className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-sm text-foreground">Avisos de interesados y preguntas</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {offer === "install"
                ? "En iPhone: toca Compartir y «Añadir a pantalla de inicio». Abre la app desde el icono y podrás activarlos."
                : "Te avisamos en cuanto un lead responda con interés o con una pregunta, aunque tengas la plataforma cerrada."}
            </p>
          </div>
          <button
            type="button"
            onClick={snooze}
            aria-label="Ahora no"
            className="-mr-1 -mt-1 flex-shrink-0 rounded-md p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-3 flex gap-2">
          {offer === "ask" && (
            <Button size="sm" className="flex-1" onClick={enable} disabled={busy}>
              {busy ? "Activando…" : "Activar avisos"}
            </Button>
          )}
          <Button size="sm" variant={offer === "ask" ? "ghost" : "default"} className={offer === "ask" ? "" : "flex-1"} onClick={snooze} disabled={busy}>
            {offer === "ask" ? "Ahora no" : "Entendido"}
          </Button>
        </div>
      </div>
    </div>
  );
}
