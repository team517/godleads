import { useEffect, useState } from "react";
import { Bell, Share, X } from "lucide-react";
import { getPushState, isPushSupported, subscribeToPush } from "@/lib/push-notifications";
import { isIosDevice } from "@/lib/push-offer";
import { isInstalledApp } from "@/lib/mobile-app";

const SNOOZE_KEY = "m-push-snooze";

/** Si este móvil aún no tiene los avisos, se ofrece activarlos (o instalar la app en iPhone). */
export function PushBanner({ userId, notify }: { userId: string; notify: (t: string, tone?: "ok" | "error") => void }) {
  const [mode, setMode] = useState<"hidden" | "ask" | "install">("hidden");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    try { if (Number(localStorage.getItem(SNOOZE_KEY) || 0) > Date.now()) return; } catch { /* nada */ }
    (async () => {
      const ios = isIosDevice(navigator.userAgent, navigator.maxTouchPoints || 0);
      if (!isPushSupported()) { if (ios && !isInstalledApp() && alive) setMode("install"); return; }
      if (Notification.permission === "denied") return;
      const st = await Promise.race([getPushState(), new Promise<"off">((r) => setTimeout(() => r("off"), 2500))]);
      if (alive && st === "off") setMode("ask");
    })();
    return () => { alive = false; };
  }, []);

  if (mode === "hidden") return null;
  const snooze = () => {
    try { localStorage.setItem(SNOOZE_KEY, String(Date.now() + 5 * 86_400_000)); } catch { /* nada */ }
    setMode("hidden");
  };
  const enable = async () => {
    setBusy(true);
    const ok = await subscribeToPush(userId).catch(() => false);
    setBusy(false);
    if (ok) { notify("Avisos activados: te llegará cada interesado"); setMode("hidden"); }
    else { notify("No se pudieron activar. Revisa los permisos de notificaciones del móvil.", "error"); snooze(); }
  };

  return (
    <div className="m-fade-in mx-3 mt-3 flex items-center gap-3 rounded-[16px] border border-[#E2E3FB] bg-gradient-to-r from-[#F1F4FE] to-[#F5F0FE] p-3 pr-2">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px] bg-white text-[#6E58F1] shadow-[0_2px_8px_rgba(80,90,200,.12)]">
        {mode === "install" ? <Share className="h-5 w-5" /> : <Bell className="h-5 w-5" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[14.5px] font-semibold text-[#0E1330]">{mode === "install" ? "Instala la app para los avisos" : "Activa los avisos"}</div>
        <div className="text-[12.5px] leading-snug text-[#6E7491]">
          {mode === "install" ? "Compartir → «Añadir a pantalla de inicio» y ábrela desde el icono." : "Te avisamos al momento de cada interesado."}
        </div>
      </div>
      {mode === "ask" && (
        <button type="button" disabled={busy} onClick={enable}
          className="m-press m-gradient h-9 shrink-0 rounded-[10px] px-3.5 text-[13.5px] font-semibold text-white disabled:opacity-60">
          Activar
        </button>
      )}
      <button type="button" aria-label="Ahora no" onClick={snooze} className="m-press flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#8A90AC]">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
