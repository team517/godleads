import { useCallback, useEffect, useState } from "react";
import { Bell, BellOff, ChevronRight, LogOut, Share, Smartphone } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getPushState, isPushSupported, subscribeToPush, unsubscribeFromPush } from "@/lib/push-notifications";
import { isIosDevice } from "@/lib/push-offer";
import { isStandalone } from "@/components/PushPrompt";
import { Avatar, Waves } from "./ui";

interface Props {
  email: string;
  conversations: number;
  unread: number;
  onSignOut: () => void;
  notify: (text: string, tone?: "ok" | "error") => void;
}

type PushState = "unsupported" | "denied" | "off" | "on" | "loading";

export function AccountView(p: Props) {
  const [push, setPush] = useState<PushState>("loading");
  const [busy, setBusy] = useState(false);
  const ios = isIosDevice(navigator.userAgent, navigator.maxTouchPoints || 0);
  const installed = isStandalone();

  const refresh = useCallback(async () => {
    if (!isPushSupported()) { setPush("unsupported"); return; }
    // getPushState espera al service worker: si no llega en 2,5 s, se da por desactivado.
    setPush(await Promise.race([getPushState(), new Promise<"off">((r) => setTimeout(() => r("off"), 2500))]));
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const userId = async () => (await supabase.auth.getUser()).data.user?.id || "";

  const toggle = async () => {
    setBusy(true);
    try {
      const uid = await userId();
      if (!uid) throw new Error("Sesión no válida");
      if (push === "on") {
        const ok = await unsubscribeFromPush(uid);
        p.notify(ok ? "Avisos desactivados en este móvil" : "No se pudieron desactivar", ok ? "ok" : "error");
      } else {
        const ok = await subscribeToPush(uid);
        p.notify(ok ? "Avisos activados: te llegará cada interesado y cada pregunta" : "No se pudieron activar. Revisa los permisos de notificaciones.", ok ? "ok" : "error");
      }
    } catch (e) {
      p.notify(e instanceof Error ? e.message : "Error", "error");
    }
    await refresh();
    setBusy(false);
  };

  const test = async () => {
    setBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-push`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token || ""}` },
        body: JSON.stringify({ test: true }),
      });
      const r = await resp.json().catch(() => ({}));
      if (!resp.ok || r?.error) throw new Error(r?.error || `HTTP ${resp.status}`);
      p.notify(Number(r?.sent) > 0 ? `Aviso de prueba enviado a ${r.sent} dispositivo(s)` : "No hay ningún dispositivo con los avisos activados", Number(r?.sent) > 0 ? "ok" : "error");
    } catch (e) {
      p.notify(`No se pudo enviar la prueba: ${e instanceof Error ? e.message : e}`, "error");
    }
    setBusy(false);
  };

  return (
    <div className="m-scroll relative h-full px-4 pb-6 pt-[calc(18px+env(safe-area-inset-top))]">
      <h1 className="px-1 text-[28px] font-bold tracking-[-0.02em] text-[#0E1330]">Account</h1>

      <div className="m-card mt-4 flex items-center gap-3.5 rounded-[18px] p-4">
        <Avatar name={p.email} size={52} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[16.5px] font-semibold text-[#0E1330]">{p.email}</div>
          <div className="mt-0.5 text-[14px] text-[#6E7491]">
            {p.conversations.toLocaleString("es-ES")} conversaciones · {p.unread.toLocaleString("es-ES")} sin leer
          </div>
        </div>
      </div>

      <h2 className="mb-2 mt-6 px-1 text-[15px] font-semibold text-[#5B6283]">Notificaciones</h2>
      <div className="m-card overflow-hidden rounded-[18px]">
        <div className="flex items-center gap-3.5 p-4">
          <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] ${push === "on" ? "bg-[#E2F7F0] text-[#16BE8E]" : "bg-[#EFEBFD] text-[#6E58F1]"}`}>
            {push === "on" ? <Bell className="h-[21px] w-[21px]" /> : <BellOff className="h-[21px] w-[21px]" />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[16px] font-semibold text-[#0E1330]">
              {push === "on" ? "Activadas en este móvil" : push === "denied" ? "Bloqueadas" : push === "unsupported" ? "No disponibles aquí" : push === "loading" ? "Comprobando…" : "Desactivadas"}
            </div>
            <div className="mt-0.5 text-[13.5px] leading-snug text-[#6E7491]">
              {push === "on" && "Te avisamos de cada interesado y de cada pregunta."}
              {push === "off" && "Actívalas para que te suene el móvil con cada interesado."}
              {push === "denied" && "Permítelas en Ajustes del móvil → Notificaciones → OnePulso."}
              {push === "unsupported" && (ios && !installed ? "En iPhone funcionan con la app instalada en la pantalla de inicio." : "Este navegador no admite avisos.")}
            </div>
          </div>
        </div>
        {(push === "on" || push === "off") && (
          <div className="grid grid-cols-2 gap-2.5 border-t border-[#F0F2F7] p-3">
            <button type="button" disabled={busy} onClick={toggle}
              className={`m-press h-11 rounded-[12px] text-[15px] font-semibold disabled:opacity-60 ${push === "on" ? "m-btn-outline text-[#3A4163]" : "m-gradient text-white"}`}>
              {push === "on" ? "Desactivar" : "Activar"}
            </button>
            <button type="button" disabled={busy || push !== "on"} onClick={test}
              className="m-press m-btn-outline h-11 rounded-[12px] text-[15px] font-semibold text-[#3D6CF0] disabled:opacity-50">
              Enviar prueba
            </button>
          </div>
        )}
        {ios && !installed && (
          <div className="flex items-start gap-3 border-t border-[#F0F2F7] p-4 text-[13.5px] leading-snug text-[#3A4163]">
            <Smartphone className="mt-0.5 h-5 w-5 shrink-0 text-[#6E58F1]" />
            <span>
              Para recibir avisos en iPhone: pulsa <Share className="mx-0.5 inline h-4 w-4 -translate-y-px text-[#3B6CF6]" /> Compartir y luego
              <b> «Añadir a pantalla de inicio»</b>. Abre OnePulso desde ese icono y activa los avisos aquí.
            </span>
          </div>
        )}
      </div>

      <h2 className="mb-2 mt-6 px-1 text-[15px] font-semibold text-[#5B6283]">Sesión</h2>
      <button type="button" onClick={p.onSignOut}
        className="m-press m-card flex w-full items-center gap-3.5 rounded-[18px] p-4 text-left">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] bg-[#FFE5EB] text-[#F0375D]">
          <LogOut className="h-[20px] w-[20px]" />
        </span>
        <span className="flex-1 text-[16px] font-semibold text-[#E5354F]">Cerrar sesión</span>
        <ChevronRight className="h-5 w-5 text-[#B0B5CA]" />
      </button>

      <Waves className="pointer-events-none mt-8 h-[120px] w-full" />
    </div>
  );
}
