// Monedas en el navegador (13-11-2026). Las reglas (packs y costes) son las mismas del servidor.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { COSTE_PERSONALIZAR, COSTE_VERIFICAR, PACKS_MONEDAS, costePersonalizar, type PackMonedas } from "../../supabase/functions/_shared/coins";

export { COSTE_PERSONALIZAR, COSTE_VERIFICAR, PACKS_MONEDAS, costePersonalizar, type PackMonedas };

/** "0,75" / "1" para enseñar un coste por unidad. */
export const fmtCoste = (n: number) => n.toLocaleString("es-ES", { maximumFractionDigits: 2 });

/** Abre la tienda de monedas desde cualquier sitio (p. ej. al faltar monedas). */
export const OPEN_COIN_STORE = "fl:open-coin-store";
export function openCoinStore() {
  try { window.dispatchEvent(new Event(OPEN_COIN_STORE)); } catch { /* fuera del navegador */ }
}

/** Avisa de que el saldo ha podido cambiar (tras verificar o lanzar una personalización). */
export const COINS_CHANGED = "fl:coins-changed";
export function notifyCoinsChanged(delayMs = 0) {
  const go = () => { try { window.dispatchEvent(new Event(COINS_CHANGED)); } catch { /* */ } };
  if (delayMs > 0) setTimeout(go, delayMs); else go();
}

/** 1.000 / 50.000 / 1.250 (en español, toLocaleString no pone el punto en números de 4 cifras). */
export const fmtNum = (n: number) => String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
export const fmtEur = (cents: number) => (cents / 100).toLocaleString("es-ES", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 }) + " €";

/** "0,004 €" por correo verificado con este pack. */
export function precioPorVerificacion(p: PackMonedas): string {
  const eur = p.cents / 100 / (p.coins / COSTE_VERIFICAR);
  return eur.toLocaleString("es-ES", { minimumFractionDigits: 3, maximumFractionDigits: 4 }) + " €";
}

/** Qué se puede hacer con N monedas. */
export function queHacerCon(n: number): { verificaciones: number; personalizaciones: number } {
  return { verificaciones: Math.floor(n / COSTE_VERIFICAR), personalizaciones: Math.floor(n / COSTE_PERSONALIZAR + 1e-9) };
}

/** Enlace de pago del pack con la cuenta del usuario dentro (el webhook le suma las monedas). */
export function coinPackUrl(p: PackMonedas, user: { id: string; email?: string | null } | null | undefined): string {
  const u = new URL(p.url);
  if (user?.id) u.searchParams.set("client_reference_id", user.id);
  if (user?.email) u.searchParams.set("prefilled_email", user.email);
  u.searchParams.set("locale", "es");
  return u.toString();
}

export interface CoinStatus { coins: number; free: boolean; ownAiKey: boolean; payerIsAgency: boolean }

export function parseCoinStatus(data: unknown): CoinStatus | null {
  const r = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  if (!r || typeof r !== "object") return null;
  return { coins: Number(r.coins) || 0, free: r.free === true, ownAiKey: r.own_ai_key === true, payerIsAgency: r.payer_is_agency === true };
}

/** ¿Alcanzan las monedas para algo que cuesta `cost`? (gratis siempre alcanza). */
export function alcanza(st: CoinStatus | null, cost: number): boolean {
  return !!st && (st.free || st.coins >= cost);
}

/** Saldo y si paga, desde el servidor. `refresh` vuelve a preguntar (tras una compra o un gasto). */
export function useCoinStatus(enabled = true): { status: CoinStatus | null; refresh: () => Promise<CoinStatus | null> } {
  const [status, setStatus] = useState<CoinStatus | null>(null);
  const refresh = useCallback(async () => {
    try {
      await (supabase as any).rpc("claim_my_coin_purchases");   // compras hechas sin la cuenta enlazada
      const { data, error } = await (supabase as any).rpc("my_coin_status");
      if (error) return null;
      const st = parseCoinStatus(data);
      setStatus(st);
      return st;
    } catch { return null; }
  }, []);
  useEffect(() => { if (enabled) void refresh(); }, [enabled, refresh]);
  useEffect(() => {
    const on = () => void refresh();
    window.addEventListener(COINS_CHANGED, on);
    return () => window.removeEventListener(COINS_CHANGED, on);
  }, [refresh]);
  return { status, refresh };
}

/** Lo que dice el servidor al quedarse sin monedas → texto para el aviso. */
export function textoSinMonedas(required?: number, available?: number): string {
  if (typeof required === "number" && typeof available === "number") return `Te faltan monedas: necesitas ${fmtNum(required)} y tienes ${fmtNum(available)}.`;
  return "Te faltan monedas para esto.";
}
