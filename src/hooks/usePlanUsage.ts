// Consumo real del plan, tal y como lo cuenta el servidor.
//
// Dos RPC, las dos `security definer` y las dos sumando la FAMILIA del plan (el
// dueño y sus cuentas de cliente): el navegador no suma nada ni sabe de quién es
// cada envío, sólo pinta lo que le dan.
//
//   my_monthly_send_usage() → { enviados, desde, hasta, cuentas }
//   my_mailbox_usage()      → { conectados, totales }
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type PlanUsage = {
  /** Correos enviados en el mes en curso por toda la familia del plan. */
  enviados: number;
  /** Inicio del mes que cuenta el servidor (hora de Madrid). */
  desde: string | null;
  /** Cuántas cuentas ha sumado: 1 = sólo la del dueño. */
  cuentas: number;
  /** Buzones conectados / dados de alta, también de toda la familia. */
  conectados: number;
  totales: number;
};

/** Las filas llegan como array (las RPC devuelven tabla) — o como objeto si algún
 *  día devolvieran una fila suelta. Se acepta lo uno y lo otro sin reventar. */
function firstRow(data: unknown): Record<string, unknown> | null {
  if (Array.isArray(data)) return (data[0] as Record<string, unknown>) ?? null;
  if (data && typeof data === "object") return data as Record<string, unknown>;
  return null;
}

const num = (v: unknown, fallback = 0) => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : fallback;
};

export function usePlanUsage() {
  // Sólo el id: la identidad del objeto `user` cambia en cada render de algunos
  // proveedores, y usarlo como dependencia haría que esto pidiera las cifras una
  // y otra vez sin parar.
  const userId = useAuth().user?.id ?? null;
  const [usage, setUsage] = useState<PlanUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userId) {
      setUsage(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [envios, buzones] = await Promise.all([
        (supabase as any).rpc("my_monthly_send_usage"),
        (supabase as any).rpc("my_mailbox_usage"),
      ]);
      if (envios?.error) throw envios.error;
      if (buzones?.error) throw buzones.error;
      const e = firstRow(envios?.data);
      const b = firstRow(buzones?.data);
      if (!e && !b) {
        setUsage(null);
        setError("No pudimos leer el consumo de tu plan.");
        return;
      }
      setUsage({
        enviados: num(e?.enviados),
        desde: (e?.desde as string) ?? null,
        cuentas: num(e?.cuentas, 1) || 1,
        conectados: num(b?.conectados),
        totales: num(b?.totales),
      });
    } catch (err) {
      setUsage(null);
      setError((err as Error)?.message || "No pudimos leer el consumo de tu plan.");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { usage, loading, error, reload: load };
}
