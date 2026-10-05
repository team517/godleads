import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { X, Shield } from "lucide-react";

// Sin framer-motion: era lo ÚNICO que lo metía en el trozo de arranque (~41 KB gz en cada
// página). La entrada/salida (opacidad, 20 px desde arriba, escala .95, 300 ms) se hace con las
// utilidades de tailwindcss-animate, que ya están en el CSS.

const KEEP_SESSION_KEY = "godleads_keep_session";
const KEEP_SESSION_DURATION_KEY = "godleads_session_duration";
const JUST_LOGGED_IN_KEY = "godleads_just_logged_in";

export type SessionDuration = "1d" | "2d" | "3d" | "7d";

const VALID_DURATIONS: SessionDuration[] = ["1d", "2d", "3d", "7d"];

const DURATION_MS: Record<SessionDuration, number> = {
  "1d": 1 * 24 * 60 * 60 * 1000,
  "2d": 2 * 24 * 60 * 60 * 1000,
  "3d": 3 * 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
};

export const DURATION_LABELS: Record<SessionDuration, string> = {
  "1d": "1 día",
  "2d": "2 días",
  "3d": "3 días",
  "7d": "1 semana",
};

export function getSessionDuration(): SessionDuration {
  const raw = localStorage.getItem(KEEP_SESSION_DURATION_KEY) as SessionDuration;
  return VALID_DURATIONS.includes(raw) ? raw : "1d";
}

export function setSessionDuration(d: SessionDuration) {
  if (!VALID_DURATIONS.includes(d)) d = "1d";
  localStorage.setItem(KEEP_SESSION_DURATION_KEY, d);
}

export function isSessionKept(): boolean {
  const raw = localStorage.getItem(KEEP_SESSION_KEY);
  if (!raw) return false;
  const expires = Number(raw);
  if (isNaN(expires) || Date.now() > expires) {
    localStorage.removeItem(KEEP_SESSION_KEY);
    return false;
  }
  return true;
}

export function getSessionExpiresAt(): number | null {
  const raw = localStorage.getItem(KEEP_SESSION_KEY);
  if (!raw) return null;
  const expires = Number(raw);
  if (isNaN(expires) || Date.now() > expires) {
    localStorage.removeItem(KEEP_SESSION_KEY);
    return null;
  }
  return expires;
}

export function activateKeepSession() {
  const dur = getSessionDuration();
  localStorage.setItem(KEEP_SESSION_KEY, String(Date.now() + DURATION_MS[dur]));
}

export function clearKeepSession() {
  localStorage.removeItem(KEEP_SESSION_KEY);
}

export function markJustLoggedIn() {
  sessionStorage.setItem(JUST_LOGGED_IN_KEY, "1");
}

export function consumeJustLoggedIn(): boolean {
  const val = sessionStorage.getItem(JUST_LOGGED_IN_KEY);
  if (val) {
    sessionStorage.removeItem(JUST_LOGGED_IN_KEY);
    return true;
  }
  return false;
}

const EXIT_MS = 300;

export function KeepSessionBanner() {
  const [visible, setVisible] = useState(false);
  // Se queda montado mientras dura la animación de salida y luego desaparece del DOM.
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    // Only show if user just logged in AND keep-session is not already active
    const justLoggedIn = consumeJustLoggedIn();
    if (!justLoggedIn || isSessionKept()) return;
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), 15000);
    return () => clearTimeout(timer);
  }, []);

  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    if (visible) { setMounted(true); setLeaving(false); return; }
    if (!mounted) return;
    // Pasa de visible a oculto: salida animada y, al acabar, fuera del DOM.
    setLeaving(true);
    const t = setTimeout(() => { setMounted(false); setLeaving(false); }, EXIT_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const handleKeep = () => {
    activateKeepSession();
    setVisible(false);
  };

  const dur = getSessionDuration();

  if (!mounted) return null;

  return (
    <div className="fixed left-1/2 top-4 z-50 -translate-x-1/2">
      <div
        className={
          "flex max-w-sm items-center gap-3 rounded-lg border bg-card px-4 py-2.5 shadow-lg duration-300 " +
          (leaving
            ? "animate-out fade-out slide-out-to-top-5 zoom-out-95 fill-mode-forwards"
            : "animate-in fade-in slide-in-from-top-5 zoom-in-95")
        }
      >
        <Shield className="h-4 w-4 text-primary shrink-0" />
        <p className="text-xs text-card-foreground">
          ¿Mantener sesión <span className="font-semibold">{DURATION_LABELS[dur]}</span>?
        </p>
        <Button size="sm" variant="default" onClick={handleKeep} className="h-7 px-3 text-xs shrink-0">
          Sí
        </Button>
        <button onClick={() => setVisible(false)} className="text-muted-foreground hover:text-foreground">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
