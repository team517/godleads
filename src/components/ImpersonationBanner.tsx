import { useEffect, useState } from "react";
import { Eye, Loader2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { AUTH_NOTICE_KEY, clearImpersonation, isStaleImpersonation, returnToOwnAccount, stateMatchesUser, useImpersonation } from "@/lib/impersonation";

/* Aviso global mientras el equipo está dentro de la cuenta de un cliente (10-11-2026). Se monta en
   App.tsx FUERA de ProtectedRoute: aunque el cliente vea una pantalla de pago o de cuenta pausada,
   el botón para volver siempre está. Flota abajo en el centro (encima de la barra del móvil). */
export function ImpersonationBanner() {
  const { user, loading } = useAuth();
  const state = useImpersonation();
  const [busy, setBusy] = useState(false);

  // Aviso pendiente de una vuelta que no pudo restaurar la sesión del equipo.
  useEffect(() => {
    try {
      const msg = sessionStorage.getItem(AUTH_NOTICE_KEY);
      if (msg) { sessionStorage.removeItem(AUTH_NOTICE_KEY); toast.info(msg); }
    } catch { /* sin almacenamiento */ }
  }, []);

  // Estado de una sesión que ya no es la del cliente (volvió en otra pestaña, cerró sesión…): fuera.
  // Pero NO mientras se está entrando: en ese instante la sesión aún es la del equipo.
  useEffect(() => {
    if (loading || !state || !user) return;
    if (isStaleImpersonation(state, user.id)) clearImpersonation();
  }, [loading, state, user]);

  if (!state || !user || !stateMatchesUser(state, user.id)) return null;

  const volver = async () => {
    setBusy(true);
    try { await returnToOwnAccount(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "No se pudo volver"); setBusy(false); }
  };

  return (
    <div
      role="status"
      className="fixed left-1/2 z-[70] flex max-w-[calc(100vw-24px)] -translate-x-1/2 items-center gap-2.5 rounded-full border border-white/15 bg-[#312A63] py-1.5 pl-3.5 pr-1.5 text-[13px] text-white shadow-[0_10px_30px_rgba(21,17,60,.35)] bottom-[calc(5rem+env(safe-area-inset-bottom))] md:bottom-5"
    >
      <Eye className="h-4 w-4 shrink-0 text-white/70" aria-hidden="true" />
      <span className="min-w-0 truncate">
        Estás viendo la cuenta de <strong className="font-semibold">{state.target.company || state.target.email}</strong>
        {state.target.company && <span className="hidden text-white/60 sm:inline"> ({state.target.email})</span>}
      </span>
      <button
        type="button"
        onClick={() => void volver()}
        disabled={busy}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white px-3 py-1 text-[12.5px] font-semibold text-[#312A63] transition-colors hover:bg-white/90 disabled:opacity-70"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />} Volver a mi cuenta
      </button>
    </div>
  );
}
