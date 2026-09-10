import { useEffect, useState } from "react";
import { Bell, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { isPushSupported, getPushPermission, subscribeToPush } from "@/lib/push-notifications";

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
 * Asks to turn on notifications the first time the app is opened from the home screen.
 *
 * It only appears where it can actually work — installed, push supported, permission still
 * undecided — because a browser tab on iOS cannot subscribe at all, and prompting there would
 * just be noise. Dismissing snoozes it for a week instead of nagging on every launch.
 */
export function PushPrompt() {
  const { user } = useAuth();
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user || !isPushSupported() || !isStandalone()) return;
    const snoozedUntil = Number(localStorage.getItem(SNOOZE_KEY) || 0);
    if (Date.now() < snoozedUntil) return;
    let alive = true;
    getPushPermission().then((perm) => {
      // "granted" → already on. "denied" → only the OS settings can undo it, so never ask.
      if (alive && perm === "default") setTimeout(() => alive && setShow(true), 1500);
    });
    return () => { alive = false; };
  }, [user]);

  const snooze = () => {
    localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_DAYS * 86400_000));
    setShow(false);
  };

  const enable = async () => {
    if (!user) return;
    setBusy(true);
    try {
      const ok = await subscribeToPush(user.id);
      if (ok) {
        toast.success("Notificaciones activadas — te avisaremos de cada interesado");
        setShow(false);
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
            <p className="font-semibold text-sm text-foreground">Avisos de leads interesados</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Te avisamos en el móvil en cuanto un lead responda con interés, aunque tengas la app cerrada.
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
          <Button size="sm" className="flex-1" onClick={enable} disabled={busy}>
            {busy ? "Activando…" : "Activar notificaciones"}
          </Button>
          <Button size="sm" variant="ghost" onClick={snooze} disabled={busy}>
            Ahora no
          </Button>
        </div>
      </div>
    </div>
  );
}
