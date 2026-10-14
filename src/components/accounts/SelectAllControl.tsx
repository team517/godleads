import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/* La casilla "seleccionar todo" de Cuentas de email (14-10-2026). Con un tag o una búsqueda
   activos hay dos "todo" posibles, así que al pulsarla pregunta: las que se ven (las del tag) o
   todas las cuentas. Sin filtro hace lo de siempre: marcar o desmarcar todas. */

export function selectAllState(visibleIds: string[], selected: Set<string>): boolean | "indeterminate" {
  if (visibleIds.length === 0) return false;
  const n = visibleIds.filter((id) => selected.has(id)).length;
  return n === visibleIds.length ? true : n > 0 ? "indeterminate" : false;
}

export default function SelectAllControl({ visibleIds, allIds, selected, onChange, scopeLabel, ariaLabel = "Seleccionar cuentas" }: {
  /** Las cuentas que se ven ahora (filtradas por tag y búsqueda). */
  visibleIds: string[];
  /** Todas las cuentas. */
  allIds: string[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  /** Qué filtra lo visible: «whatsapp», «la búsqueda»… (null = no hay filtro). */
  scopeLabel: string | null;
  ariaLabel?: string;
}) {
  const state = selectAllState(visibleIds, selected);
  const filtered = !!scopeLabel && visibleIds.length < allIds.length;

  if (!filtered) {
    return (
      <Checkbox
        checked={state}
        onCheckedChange={() => onChange(state === true ? new Set() : new Set(allIds))}
        aria-label={ariaLabel}
      />
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="flex items-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={ariaLabel}>
          <Checkbox checked={state} tabIndex={-1} className="pointer-events-none" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[240px]">
        <DropdownMenuItem onSelect={() => onChange(new Set([...selected, ...visibleIds]))}>
          Seleccionar las {visibleIds.length} de {scopeLabel}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onChange(new Set(allIds))}>
          Seleccionar todas las cuentas ({allIds.length})
        </DropdownMenuItem>
        {selected.size > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onChange(new Set())}>
              Quitar selección ({selected.size})
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
