import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/* Confirmación de un pago de Stripe (11-11-2026). El ÚNICO que da un plan es el servidor: el webhook
   firmado de Stripe (o check-subscription, que pregunta a Stripe) escribe user_entitlements, y el
   navegador sólo puede LEER su propia fila (RLS "owner read"). Aquí no hay botón de "ya he pagado":
   se mira la fila cada pocos segundos (y al volver a la pestaña) y sólo cuando el servidor la cambia
   se pasa a "Procesando tu plan…" y después a "¡Listo!". Ninguna URL (?paso=listo, success_url) ni
   marca del navegador cuenta. */

export interface EntitlementRow {
  status: string | null;
  tier: string | null;
  custom_level: number | null;
  stripe_subscription_id: string | null;
  current_period_end: string | null;
  last_event_at: string | null;
}

export type PaymentStage = "esperando" | "procesando" | "listo";

const COLS = "status, tier, custom_level, stripe_subscription_id, current_period_end, last_event_at";
export const PAYMENT_POLL_MS = 2500;
/** "Procesando tu plan…": animación corta, SIEMPRE después de que el servidor lo haya confirmado. */
export const PAYMENT_PROCESSING_MS = 1500;
/** Sin confirmación en este tiempo: se ofrece escribirnos (nunca un botón de "ya he pagado"). */
export const PAYMENT_SLOW_MS = 10 * 60 * 1000;

const conAcceso = (s: string | null | undefined) => s === "active" || s === "trialing";

/** ¿La fila del servidor confirma el plan pedido? Puro (se prueba con vitest).
 *  · Plan a medida: estado activo y el nivel pedido; si ya tenía ese nivel activo antes de pagar, no
 *    cuenta (un cambio de plan sólo se da por hecho cuando la fila CAMBIA).
 *  · Planes con prueba: trialing o active (y, si ya tenía acceso antes, que la suscripción cambie). */
export function isPaymentConfirmed(
  want: { kind: "custom"; level: number } | { kind: "plan" },
  row: Partial<EntitlementRow> | null | undefined,
  baseline: Partial<EntitlementRow> | null | undefined,
): boolean {
  if (!row || !conAcceso(row.status)) return false;
  if (want.kind === "custom") {
    if (Number(row.custom_level) !== want.level) return false;
    const yaLoTenia = !!baseline && conAcceso(baseline.status) && Number(baseline.custom_level) === want.level;
    return !yaLoTenia;
  }
  if (baseline && conAcceso(baseline.status)) {
    // Ya tenía acceso: sólo vale un cambio real de la suscripción.
    return (row.stripe_subscription_id ?? null) !== (baseline.stripe_subscription_id ?? null)
      || (row.tier ?? null) !== (baseline.tier ?? null)
      || (row.custom_level ?? null) !== (baseline.custom_level ?? null);
  }
  return true;
}

/** La fila del servidor de este usuario (sólo lectura: RLS "owner read"). */
export async function readEntitlement(userId: string): Promise<EntitlementRow | null> {
  try {
    const { data } = await (supabase as any).from("user_entitlements").select(COLS).eq("user_id", userId).maybeSingle();
    return (data as EntitlementRow) ?? null;
  } catch { return null; }
}

/**
 * Vigila la fila de user_entitlements mientras `active` es true.
 * `baseline`: "capture" = la fila de ahora (para cambios de plan); null = no había nada antes.
 */
export function usePaymentConfirmation(opts: {
  active: boolean;
  userId: string | null | undefined;
  want: { kind: "custom"; level: number } | { kind: "plan" };
  /** Cómo estaba antes de pagar: la fila leída al confirmar (cambios de plan), "capture" = la primera
   *  lectura, o null = no había nada. */
  baseline?: "capture" | EntitlementRow | null;
  onConfirmed?: (row: EntitlementRow) => void;
}): { stage: PaymentStage; slow: boolean; row: EntitlementRow | null } {
  const { active, userId, want } = opts;
  const [stage, setStage] = useState<PaymentStage>("esperando");
  const [slow, setSlow] = useState(false);
  const [row, setRow] = useState<EntitlementRow | null>(null);
  const confirmado = useRef(false);
  const onConfirmed = useRef(opts.onConfirmed);
  onConfirmed.current = opts.onConfirmed;
  const wantKey = want.kind === "custom" ? `custom-${want.level}` : "plan";

  useEffect(() => {
    if (!active || !userId) return;
    let vivo = true;
    confirmado.current = false;
    setStage("esperando"); setSlow(false);
    let base: EntitlementRow | null | undefined = opts.baseline === "capture" ? undefined : (opts.baseline ?? null);
    let ticks = 0;
    let tProcesando: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      if (!vivo || confirmado.current) return;
      ticks++;
      // De vez en cuando se pide al servidor que pregunte a Stripe (si la clave falla no pasa nada).
      if (ticks % 6 === 0) { try { void supabase.functions.invoke("check-subscription"); } catch { /* nada */ } }
      const r = await readEntitlement(userId);
      if (!vivo || confirmado.current) return;
      if (base === undefined) { base = r; return; } // primera lectura = cómo estaba antes de pagar
      setRow(r);
      if (isPaymentConfirmed(want, r, base)) {
        confirmado.current = true;
        setStage("procesando");
        onConfirmed.current?.(r!);
        tProcesando = setTimeout(() => { if (vivo) setStage("listo"); }, PAYMENT_PROCESSING_MS);
      }
    };

    void tick();
    const t = setInterval(() => void tick(), PAYMENT_POLL_MS);
    const tSlow = setTimeout(() => { if (vivo && !confirmado.current) setSlow(true); }, PAYMENT_SLOW_MS);
    const alVolver = () => { if (document.visibilityState === "visible") void tick(); };
    const alFoco = () => void tick();
    window.addEventListener("focus", alFoco);
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      vivo = false;
      clearInterval(t); clearTimeout(tSlow); if (tProcesando) clearTimeout(tProcesando);
      window.removeEventListener("focus", alFoco);
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, [active, userId, wantKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return { stage, slow, row };
}

/** Pantallas de "prueba terminada" / "pago pendiente": sin botón de "ya he pagado". Se lee la fila
 *  del servidor en silencio (al volver a la pestaña y cada 20 s) y SÓLO cuando ya da acceso se recarga
 *  la suscripción (recargarla enseña un "cargando" de toda la app: así pasa una sola vez). */
export function useAutoRefreshSubscription(refresh: () => Promise<void>, userId: string | null | undefined, everyMs = 20_000) {
  const ref = useRef(refresh);
  ref.current = refresh;
  useEffect(() => {
    if (!userId) return;
    let n = 0;
    let hecho = false;
    const go = async () => {
      if (hecho) return;
      n++;
      if (n % 3 === 0) { try { void supabase.functions.invoke("check-subscription"); } catch { /* nada */ } }
      const r = await readEntitlement(userId);
      if (!hecho && r && conAcceso(r.status)) { hecho = true; void ref.current(); }
    };
    const t = setInterval(() => void go(), everyMs);
    const alVolver = () => { if (document.visibilityState === "visible") void go(); };
    const alFoco = () => void go();
    window.addEventListener("focus", alFoco);
    document.addEventListener("visibilitychange", alVolver);
    return () => { clearInterval(t); window.removeEventListener("focus", alFoco); document.removeEventListener("visibilitychange", alVolver); };
  }, [userId, everyMs]);
}
