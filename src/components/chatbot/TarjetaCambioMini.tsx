import { useState } from "react";
import { Check, ChevronDown, ListChecks, Loader2, Mail, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { IaTarjeta } from "@/lib/ia-mod-view";

/* Tarjeta de un cambio de PulseBot dentro del chatbot flotante: qué cambió (o cambiaría), su
   estado real y los botones. Versión compacta de la de Modificaciones IA. */

export type TarjetaCambioT = Extract<IaTarjeta, { type: "cambio" | "pendiente" }>;
export type AccionCambio = "confirm" | "cancel" | "undo";

const ESTADO: Record<string, string> = { applied: "Aplicado", pending: "Pendiente", undone: "Deshecho", cancelled: "Cancelado" };

function Correo({ asunto, cuerpo, cabecera }: { asunto?: string; cuerpo?: string; cabecera?: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-background">
      {cabecera && <p className="flex items-center gap-1.5 border-b border-border/60 px-3 py-1.5 text-[11.5px] font-medium text-muted-foreground"><Mail className="h-3.5 w-3.5" /> {cabecera}</p>}
      <div className="px-3 py-2.5">
        <p className="text-[12.5px]"><span className="text-muted-foreground">Asunto: </span>{asunto ? <strong className="font-bold">{asunto}</strong> : <span className="italic text-muted-foreground">mismo hilo (Re: del primero)</span>}</p>
        <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed">{cuerpo}</p>
      </div>
    </div>
  );
}

export function TarjetaCambioMini({ t, estado, onAccion }: { t: TarjetaCambioT; estado: string; onAccion: (id: string, a: AccionCambio) => Promise<void> }) {
  const [trabajando, setTrabajando] = useState(false);
  const [abierto, setAbierto] = useState(true);
  const hacer = async (a: AccionCambio) => { setTrabajando(true); try { await onAccion(t.change_id, a); } finally { setTrabajando(false); } };
  const marco = estado === "applied" ? "border-emerald-200 bg-emerald-50/60 dark:bg-emerald-500/10" : estado === "pending" ? "border-amber-200 bg-amber-50/60 dark:bg-amber-500/10" : "border-border bg-card";
  return (
    <div className={`mt-2 space-y-2.5 rounded-xl border p-3 ${marco}`} data-testid="tarjeta-cambio">
      <div className="flex items-center justify-between gap-2">
        <button type="button" className="flex min-w-0 items-center gap-2 text-left text-[13.5px] font-semibold" onClick={() => setAbierto((v) => !v)}>
          <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${estado === "pending" ? "bg-amber-100 text-amber-600" : estado === "applied" ? "bg-emerald-100 text-emerald-600" : "bg-muted text-muted-foreground"}`}>
            {estado === "pending" ? <ListChecks className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
          </span>
          <span className="truncate">{t.summary}</span>
          <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${abierto ? "" : "-rotate-90"}`} />
        </button>
        <span className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${estado === "applied" ? "border-emerald-300 text-emerald-700" : estado === "pending" ? "border-amber-300 text-amber-700" : "text-muted-foreground"}`}>
          {ESTADO[estado] || estado}
        </span>
      </div>
      {abierto && (
        <div className="space-y-2">
          {t.mensajes?.map((m) => (
            <Correo key={m.posicion} cabecera={`Mensaje ${m.posicion}${m.posicion > 1 ? ` · a los ${m.espera_dias} días` : ""}`} asunto={m.asunto} cuerpo={m.cuerpo} />
          ))}
          {t.cuerpo !== undefined && (
            <Correo cabecera={`${t.letra ? `Variante ${t.letra} · ` : ""}Mensaje ${t.posicion ?? ""}${t.espera_dias !== undefined && (t.posicion ?? 1) > 1 ? ` · a los ${t.espera_dias} días` : ""}`} asunto={t.asunto} cuerpo={t.cuerpo} />
          )}
          {(t.lineas || []).length > 0 && (
            <ul className="space-y-0.5 rounded-xl border border-border/60 bg-background px-3 py-2 text-[12.5px]">
              {t.lineas!.map((l) => <li key={l} className="flex gap-2"><span className="text-primary">•</span><span>{l}</span></li>)}
            </ul>
          )}
          {t.aviso && <p className="text-[12.5px] text-muted-foreground">{t.aviso}</p>}
          {t.activa && estado === "applied" && <p className="text-[12.5px] text-muted-foreground">La campaña está activa: se usa desde el próximo envío.</p>}
        </div>
      )}
      <div className="flex gap-2">
        {estado === "pending" && (
          <>
            <Button size="sm" className="h-8 gap-1.5 rounded-lg" disabled={trabajando} onClick={() => hacer("confirm")}>
              {trabajando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Confirmar
            </Button>
            <Button size="sm" variant="outline" className="h-8 rounded-lg" disabled={trabajando} onClick={() => hacer("cancel")}>Cancelar</Button>
          </>
        )}
        {estado === "applied" && (
          <Button size="sm" variant="outline" className="h-8 gap-1.5 rounded-lg bg-background" disabled={trabajando} onClick={() => hacer("undo")}>
            {trabajando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />} Deshacer
          </Button>
        )}
      </div>
    </div>
  );
}
