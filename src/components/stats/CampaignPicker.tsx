import { useMemo, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type PickerCampaign = { id: string; name: string; status?: string | null };

const STATUS: Record<string, { label: string; cls: string }> = {
  active: { label: "Activa", cls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  paused: { label: "Pausada", cls: "bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  completed: { label: "Terminada", cls: "bg-muted text-muted-foreground" },
  draft: { label: "Borrador", cls: "bg-muted text-muted-foreground" },
};

/** Texto del botón: «Todas las campañas», el nombre de la única elegida o «N campañas». */
export function pickerLabel(campaigns: PickerCampaign[], selected: readonly string[]): string {
  if (selected.length === 0) return "Todas las campañas";
  if (selected.length === 1) return campaigns.find((c) => c.id === selected[0])?.name || "1 campaña";
  return `${selected.length} campañas`;
}

/* Selector de campañas de Estadísticas (13-10-2026): una, varias o todas. Sin nada marcado = todas.
   Buscador, «Todas» y «Sólo activas»; las activas primero. */
export default function CampaignPicker({ campaigns, selected, onChange, className }: {
  campaigns: PickerCampaign[];
  selected: string[];
  onChange: (ids: string[]) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const sel = useMemo(() => new Set(selected), [selected]);
  const sorted = useMemo(() => {
    const rank = (s?: string | null) => (s === "active" ? 0 : s === "paused" ? 1 : 2);
    return [...campaigns].sort((a, b) => rank(a.status) - rank(b.status) || a.name.localeCompare(b.name, "es"));
  }, [campaigns]);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? sorted.filter((c) => c.name.toLowerCase().includes(t)) : sorted;
  }, [sorted, q]);
  const activeIds = useMemo(() => campaigns.filter((c) => c.status === "active").map((c) => c.id), [campaigns]);

  const toggle = (id: string) => {
    const next = new Set(sel);
    if (next.has(id)) next.delete(id); else next.add(id);
    // Todas marcadas una a una = sin filtro.
    onChange(next.size === campaigns.length ? [] : [...next]);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className={cn("h-9 max-w-full justify-between gap-2 font-medium", selected.length > 0 && "border-primary/50 bg-primary/5 text-primary", className)}>
          <span className="truncate">{pickerLabel(campaigns, selected)}</span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(92vw,360px)] p-0">
        <div className="border-b border-border p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar campaña…" className="h-8 pl-8 text-sm" />
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Button size="sm" variant={selected.length === 0 ? "default" : "outline"} className="h-7 px-2.5 text-xs" onClick={() => onChange([])}>Todas</Button>
            {activeIds.length > 0 && activeIds.length < campaigns.length && (
              <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs" onClick={() => onChange(activeIds)}>Sólo activas ({activeIds.length})</Button>
            )}
          </div>
        </div>
        <div className="max-h-[320px] overflow-y-auto p-1" role="listbox" aria-multiselectable="true">
          {shown.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted-foreground">Ninguna campaña con ese nombre.</p>}
          {shown.map((c) => {
            const on = sel.has(c.id);
            const st = STATUS[String(c.status || "")];
            return (
              <button
                key={c.id}
                type="button"
                role="option"
                aria-selected={on}
                onClick={() => toggle(c.id)}
                className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm hover:bg-muted"
              >
                <span className={cn("flex h-4 w-4 shrink-0 items-center justify-center rounded border", on ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40")}>
                  {on && <Check className="h-3 w-3" />}
                </span>
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                {st && <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold", st.cls)}>{st.label}</span>}
              </button>
            );
          })}
        </div>
        {selected.length > 0 && (
          <div className="flex items-center justify-between border-t border-border px-3 py-2 text-xs text-muted-foreground">
            <span>{selected.length} de {campaigns.length} elegidas</span>
            <button type="button" className="font-semibold text-primary hover:underline" onClick={() => onChange([])}>Quitar filtro</button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
