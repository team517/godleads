import { useEffect, useMemo, useState } from "react";
import { CalendarClock, ChevronDown, Clock, Loader2, Plane } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { esperasPorLead, textoVuelta, tooltipVuelta, type EsperaOoo } from "@/lib/ooo-chip";

/* Opciones de "Fuera de oficina: esperar a que vuelva" (12-11-2026): cuándo se le escribe al volver,
   qué hacer si no dice cuándo vuelve y quién está esperando ahora mismo en esta campaña. */

export const OOO_DELAY_OPTIONS = [
  { value: 0, label: "El día que vuelve" },
  { value: 1, label: "1 día después" },
  { value: 2, label: "2 días después" },
  { value: 3, label: "3 días después" },
] as const;

export const OOO_NO_DATE_OPTIONS = [
  { value: 0, label: "Seguir normal" },
  { value: 3, label: "Esperar 3 días" },
  { value: 7, label: "Esperar 1 semana" },
  { value: 14, label: "Esperar 2 semanas" },
] as const;

function Segmented({ value, options, onChange, label }: {
  value: number;
  options: readonly { value: number; label: string }[];
  onChange: (v: number) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cn(
              "rounded-lg border px-2.5 py-2 text-[12.5px] font-medium transition-all",
              on ? "border-primary bg-primary/10 text-primary shadow-[0_0_0_2px_hsl(var(--primary)/0.12)]" : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

type Espera = EsperaOoo & { email: string | null; source: string | null };

/** Fecha corta "15 nov". */
function corta(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("es-ES", { day: "numeric", month: "short", timeZone: "Europe/Madrid" }).replace(".", "");
}

export function OooOptions({ campaignId, delay, noDate, onDelay, onNoDate }: {
  campaignId: string;
  delay: number;
  noDate: number;
  onDelay: (v: number) => void;
  onNoDate: (v: number) => void;
}) {
  const [rows, setRows] = useState<Espera[] | null>(null);
  const [all, setAll] = useState(false);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const { data, error } = await (supabase as any)
        .from("ooo_returns")
        .select("lead_id, return_date, scheduled_for, snippet, source, leads(email)")
        .eq("campaign_id", campaignId)
        .eq("status", "programado")
        .gt("scheduled_for", new Date().toISOString())
        .order("scheduled_for", { ascending: true })
        .limit(500);
      if (!vivo) return;
      if (error) { setRows([]); return; }
      const filas: Espera[] = (data || []).map((r: any) => ({ lead_id: r.lead_id, return_date: r.return_date, scheduled_for: r.scheduled_for, snippet: r.snippet, source: r.source, email: r.leads?.email ?? null }));
      // Una fila por lead (la espera más tardía), ordenadas por el día en que se le vuelve a escribir.
      const porLead = esperasPorLead(filas) as Record<string, Espera>;
      setRows(Object.values(porLead).sort((a, b) => Date.parse(a.scheduled_for || "") - Date.parse(b.scheduled_for || "")));
    })();
    return () => { vivo = false; };
  }, [campaignId]);

  const visibles = useMemo(() => (rows ? (all ? rows : rows.slice(0, 5)) : []), [rows, all]);

  return (
    <div className="space-y-4" data-testid="ooo-options">
      <div>
        <p className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-semibold text-foreground">
          <CalendarClock className="h-3.5 w-3.5 text-amber-600" /> Cuándo le escribimos cuando vuelve
        </p>
        <Segmented label="Cuándo le escribimos cuando vuelve" value={delay} options={OOO_DELAY_OPTIONS} onChange={onDelay} />
        <p className="mt-1.5 text-[11.5px] text-muted-foreground">
          {delay === 0
            ? "El mismo día que vuelve, a la hora de inicio de la campaña."
            : `Le damos ${delay === 1 ? "un día" : `${delay} días`} para ponerse al día con su bandeja antes del siguiente correo.`} Si cae en fin de semana, el lunes.
        </p>
      </div>

      <div>
        <p className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-semibold text-foreground">
          <Clock className="h-3.5 w-3.5 text-amber-600" /> Si no dice cuándo vuelve
        </p>
        <Segmented label="Si no dice cuándo vuelve" value={noDate} options={OOO_NO_DATE_OPTIONS} onChange={onNoDate} />
        <p className="mt-1.5 text-[11.5px] text-muted-foreground">
          {noDate === 0
            ? "Sigue la secuencia como si nada (el siguiente correo sale cuando toca)."
            : `Esperamos ${noDate === 7 ? "una semana" : noDate === 14 ? "dos semanas" : `${noDate} días`} desde su respuesta automática antes del siguiente correo. Si dice que ya no trabaja allí, no se espera.`}
        </p>
      </div>

      <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-foreground">
            <Plane className="h-3.5 w-3.5 text-amber-600" /> Esperando ahora
          </p>
          {rows === null
            ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            : <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-bold text-amber-700 dark:text-amber-400">{rows.length}</span>}
        </div>
        {rows !== null && rows.length === 0 && (
          <p className="mt-1.5 text-[11.5px] text-muted-foreground">Nadie de esta campaña está esperando a volver de vacaciones ahora mismo.</p>
        )}
        {visibles.length > 0 && (
          <ul className="mt-2 divide-y divide-border/60">
            {visibles.map((r) => (
              <li key={r.lead_id} className="flex items-center justify-between gap-3 py-1.5" title={tooltipVuelta(r)}>
                <span className="min-w-0 truncate text-[12.5px] text-foreground">{r.email || "Lead"}</span>
                <span className="flex shrink-0 items-center gap-2 text-[11.5px]">
                  <span className="text-muted-foreground">{r.source === "espera" ? "Sin fecha" : textoVuelta(r.return_date).replace("Fuera · ", "")}</span>
                  <span className="rounded-md bg-primary/10 px-1.5 py-0.5 font-semibold text-primary">Le escribimos el {corta(r.scheduled_for)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
        {rows && rows.length > 5 && (
          <button type="button" onClick={() => setAll((v) => !v)} className="mt-1.5 inline-flex items-center gap-1 text-[11.5px] font-semibold text-primary hover:underline">
            {all ? "Ver menos" : `Ver los ${rows.length}`} <ChevronDown className={cn("h-3 w-3 transition-transform", all && "rotate-180")} />
          </button>
        )}
      </div>
    </div>
  );
}

export default OooOptions;
