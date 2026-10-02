import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AUTO_MIN_NEW_PCT, balancedNewPct, clampPct, mixAdvice, mixEstimate, resolveNewPct, type MixMode } from "@/lib/lead-mix";

/* Reparto del día entre primeros correos y seguimientos (opciones de campaña).
   Tres modos: como siempre (seguimientos primero), automático (equilibrio según los pasos) y
   manual (la barra). Debajo se ve qué saldría HOY con ese reparto. */

export interface LeadMixValue { mode: MixMode; pct: number; maxNewPerDay: number | null }

interface Props {
  campaignId: string;
  /** Correos que la campaña puede enviar hoy (su límite o la capacidad de sus cuentas). */
  capacityToday: number;
  value: LeadMixValue;
  onChange: (v: LeadMixValue) => void;
}

const MODES: { id: MixMode; label: string; hint: string }[] = [
  { id: "off", label: "Como siempre", hint: "Primero salen todos los seguimientos; lo que sobra, para leads nuevos." },
  { id: "auto", label: "Automático", hint: "Equilibrio según los pasos de la secuencia. Recomendado." },
  { id: "manual", label: "Manual", hint: "Tú eliges el porcentaje con la barra." },
];

export function LeadMixControl({ campaignId, capacityToday, value, onChange }: Props) {
  const [steps, setSteps] = useState<number>(0);
  const [pending, setPending] = useState<number | null>(null);
  const [dueToday, setDueToday] = useState<number | null>(null);

  // Lo que hace falta para la estimación: pasos, leads sin primer correo y seguimientos que tocan hoy.
  useEffect(() => {
    let alive = true;
    (async () => {
      const { data: st } = await supabase.from("campaign_steps").select("step_order, delay_days").eq("campaign_id", campaignId).order("step_order");
      const list = (st || []) as { step_order: number; delay_days: number | null }[];
      if (!alive) return;
      setSteps(list.length);
      const { count: pend } = await supabase.from("campaign_leads").select("id", { count: "exact", head: true }).eq("campaign_id", campaignId).eq("status", "pending");
      if (!alive) return;
      setPending(pend ?? 0);
      // Seguimientos que tocan hoy: leads en secuencia cuyo paso siguiente vence antes de acabar el día.
      const endOfDay = new Date(); endOfDay.setHours(23, 59, 59, 999);
      let due = 0;
      for (let i = 1; i < list.length; i++) {
        const limit = new Date(endOfDay.getTime() - (list[i].delay_days || 0) * 86_400_000).toISOString();
        const { count } = await supabase.from("campaign_leads").select("id", { count: "exact", head: true })
          .eq("campaign_id", campaignId).eq("status", "in_progress").eq("current_step", i).lte("last_sent_at", limit);
        due += count ?? 0;
      }
      if (alive) setDueToday(due);
    })().catch(() => { /* sin estimación: la barra funciona igual */ });
    return () => { alive = false; };
  }, [campaignId]);

  const { mode, pct, maxNewPerDay } = value;
  const balance = balancedNewPct(steps || 3);
  const known = pending !== null && dueToday !== null && capacityToday > 0;
  const shownPct = mode === "manual" ? clampPct(pct)
    : mode === "auto" ? (resolveNewPct({ mode: "auto", steps: steps || 3, dailyLimit: capacityToday, followupsDueToday: dueToday ?? 0 }) ?? balance)
    : null;
  const est = known && shownPct !== null
    ? mixEstimate({ dailyLimit: capacityToday, newPct: shownPct, newPending: pending!, followupsDueToday: dueToday!, maxNewPerDay })
    : null;
  // El consejo general no se enseña si contradice lo que va a pasar HOY (hay cola y aun así quedan seguimientos fuera).
  const general = mode === "manual" ? mixAdvice(clampPct(pct), steps || 3) : null;
  const advice = general && !(general.tone !== "warn" && est && est.aplazados > 0) ? general : null;
  const fmt = (n: number) => n.toLocaleString("es-ES");

  return (
    <div className="space-y-3" data-testid="lead-mix">
      <div className="inline-flex overflow-hidden rounded-md border border-border bg-background" role="radiogroup" aria-label="Reparto del día">
        {MODES.map((m) => (
          <button key={m.id} type="button" role="radio" aria-checked={mode === m.id} title={m.hint}
            onClick={() => onChange({ ...value, mode: m.id, pct: m.id === "manual" && mode !== "manual" ? (shownPct ?? balance) : pct })}
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${mode === m.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>
            {m.label}
          </button>
        ))}
      </div>

      {mode === "off" && (
        <p className="text-xs text-muted-foreground">Primero salen todos los seguimientos pendientes y lo que sobra del día se usa en leads nuevos. Con una cola de seguimientos puede haber días sin ningún primer correo.</p>
      )}

      {shownPct !== null && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs font-medium">
            <span className="text-primary">{shownPct} % leads nuevos</span>
            <span className="text-muted-foreground">{100 - shownPct} % seguimientos</span>
          </div>
          {/* La barra: la parte de color son los leads nuevos. En manual se arrastra. */}
          {mode !== "manual" && (
            <div className="relative h-2.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-[width] duration-150" style={{ width: `${shownPct}%` }} />
            </div>
          )}
          {mode === "manual" && (
            <input type="range" min={0} max={100} step={5} value={clampPct(pct)} aria-label="Porcentaje de leads nuevos"
              onChange={(e) => onChange({ ...value, pct: clampPct(Number(e.target.value)) })}
              className="block w-full cursor-pointer accent-[hsl(var(--primary))]" />
          )}
          {mode === "auto" && (
            <p className="text-xs text-muted-foreground">
              Con {steps || 3} pasos el equilibrio es {balance} % de nuevos.
              {shownPct < balance
                ? ` Hoy hay cola de seguimientos, así que los nuevos bajan a ${shownPct} % para ponerse al día (nunca menos de ${AUTO_MIN_NEW_PCT} %).`
                : " Si un día faltan seguimientos, su parte pasa a leads nuevos, y al revés."}
            </p>
          )}
          {advice && (
            <p className={`text-xs ${advice.tone === "warn" ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>{advice.text}</p>
          )}
          {est && (
            <p className="rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground" data-testid="lead-mix-estimate">
              Hoy, con {fmt(capacityToday)} envíos: unos <span className="font-semibold text-foreground">{fmt(est.nuevos)} primeros correos</span> y{" "}
              <span className="font-semibold text-foreground">{fmt(est.seguimientos)} seguimientos</span>.
              {est.aplazados > 0 ? ` Quedarían ${fmt(est.aplazados)} seguimientos para otro día.` : " Los seguimientos van al día."}
            </p>
          )}
          <label className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>Máximo de leads nuevos al día</span>
            <input type="number" min={0} inputMode="numeric" placeholder="sin tope" value={maxNewPerDay ?? ""}
              onChange={(e) => { const n = parseInt(e.target.value); onChange({ ...value, maxNewPerDay: Number.isFinite(n) && n > 0 ? n : null }); }}
              className="h-8 w-24 rounded-md border border-border bg-background px-2 text-sm text-foreground" />
            <span>Déjalo vacío para no limitar. Sirve para que la lista no se acabe demasiado rápido.</span>
          </label>
        </div>
      )}
    </div>
  );
}
