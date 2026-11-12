import { useEffect, useMemo, useRef, useState } from "react";
import { Building2, Loader2, LogIn, RotateCcw, Search, Undo2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { enterClient, listClientsForSwitch, returnToOwnAccount, type ImpersonationState } from "@/lib/impersonation";
import { coincideCliente, nombreCuenta, type ClienteListado } from "../../supabase/functions/_shared/impersonation-rules";

/* "Clientes" del menú del perfil (hello@ y equipo@: todas las cuentas; una agencia: las de SUS clientes) para entrar en
   una sin contraseña. Un clic entra; en la que ya estás, "Quitar" vuelve a tu cuenta. */

const PLAN_LABEL: Record<string, string> = { starter: "Starter", growth: "Growth", scale: "Scale" };
const TIPO_LABEL: Record<ClienteListado["tipo"], string> = { cliente: "Cliente", acceso_cliente: "Acceso de cliente", registro: "Registro" };

function iniciales(c: ClienteListado): string {
  const n = nombreCuenta(c).replace(/[^\p{L}\p{N} ]/gu, " ").trim().split(/\s+/);
  return ((n[0]?.[0] || "") + (n[1]?.[0] || "")).toUpperCase() || "?";
}

function planTexto(c: ClienteListado): string | null {
  const t = c.plan_tier && PLAN_LABEL[c.plan_tier];
  if (!t) return null;
  if (c.plan_status === "trialing") return `${t} · prueba`;
  if (c.plan_status === "past_due" || c.plan_status === "unpaid") return `${t} · pago pendiente`;
  if (c.plan_status === "active") return t;
  return null;
}

export function AccountSwitcherDialog({ open, onOpenChange, current, agencia = false }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  current: ImpersonationState | null;
  /** Agencia (12-11-2026): sólo ve y entra en los accesos de SUS clientes. */
  agencia?: boolean;
}) {
  const [clients, setClients] = useState<ClienteListado[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const cargar = async () => {
    setError(null);
    setClients(null);
    try { setClients(await listClientsForSwitch()); }
    catch (e) { setError(e instanceof Error ? e.message : "No se pudo cargar la lista"); }
  };

  useEffect(() => {
    if (!open) return;
    setQ("");
    setBusy(null);
    void cargar();
    const t = setTimeout(() => searchRef.current?.focus(), 80);
    return () => clearTimeout(t);
  }, [open]);

  const visibles = useMemo(() => (clients || []).filter((c) => coincideCliente(c, q)), [clients, q]);

  const entrar = async (c: ClienteListado) => {
    if (busy) return;
    setBusy(c.id);
    setError(null);
    try { await enterClient(c.id); }
    catch (e) { setError(e instanceof Error ? e.message : "No se pudo entrar"); setBusy(null); }
  };

  const quitar = async () => {
    if (busy) return;
    setBusy("__volver");
    try { await returnToOwnAccount(); }
    catch (e) { setError(e instanceof Error ? e.message : "No se pudo volver"); setBusy(null); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }}>
      <DialogContent className="max-w-xl gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-5 pb-3 pt-5 text-left">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Building2 className="h-4 w-4 text-primary" aria-hidden="true" /> Clientes
          </DialogTitle>
          <DialogDescription className="text-[12.5px]">
            {agencia
              ? "Entra en la cuenta de cualquiera de tus clientes sin contraseña, para ver o preparar lo suyo. Vuelves a la tuya desde el aviso de abajo o desde tu perfil."
              : "Entra en la cuenta de cualquier cliente sin contraseña. Vuelves a la tuya desde el aviso de abajo o desde tu perfil."}
          </DialogDescription>
          <div className="relative mt-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              ref={searchRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar por empresa, nombre o correo…"
              aria-label="Buscar cliente"
              className="h-10 pl-9"
            />
          </div>
        </DialogHeader>

        {current && (
          <div className="flex items-center justify-between gap-3 border-b bg-primary/5 px-5 py-2.5 text-[13px]">
            <span className="min-w-0 truncate">Estás dentro de <strong>{current.target.company || current.target.email}</strong></span>
            <Button size="sm" variant="outline" className="h-8 shrink-0 gap-1.5" onClick={() => void quitar()} disabled={!!busy}>
              {busy === "__volver" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />} Volver a mi cuenta
            </Button>
          </div>
        )}

        <div className="max-h-[60vh] overflow-y-auto p-2" role="list" aria-label="Cuentas de clientes">
          {error && (
            <div className="m-2 flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-[13px] text-destructive">
              <span>{error}</span>
              {!clients && <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => void cargar()}><RotateCcw className="h-3.5 w-3.5" /> Reintentar</Button>}
            </div>
          )}
          {!clients && !error && (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Cargando clientes…
            </div>
          )}
          {clients && visibles.length === 0 && (
            <p className="py-10 text-center text-sm text-muted-foreground">{q.trim() ? `Ninguna cuenta coincide con «${q.trim()}».` : (agencia ? "Tus clientes aún no tienen acceso. Créaselo en Clientes → Configurar → Acceso." : "No hay cuentas de clientes.")}</p>
          )}
          {visibles.map((c) => {
            const dentro = current?.target.userId === c.id;
            const plan = planTexto(c);
            return (
              <div key={c.id} role="listitem"
                className={cn("group flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors", dentro ? "bg-primary/10" : "hover:bg-muted")}>
                {c.avatar_url
                  ? <img src={c.avatar_url} alt="" className="h-9 w-9 shrink-0 rounded-lg border bg-card object-contain" />
                  : <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-[12.5px] font-bold text-primary">{iniciales(c)}</span>}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold text-foreground">{nombreCuenta(c)}</p>
                  <p className="truncate text-[12px] text-muted-foreground">{c.email}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10.5px] font-semibold">
                    <span className="rounded-full bg-secondary px-2 py-0.5 text-secondary-foreground">{TIPO_LABEL[c.tipo]}</span>
                    {plan && <span className="rounded-full bg-accent px-2 py-0.5 text-accent-foreground">{plan}</span>}
                    {c.active_campaigns > 0 && <span className="rounded-full bg-success/15 px-2 py-0.5 text-success">{c.active_campaigns} {c.active_campaigns === 1 ? "campaña activa" : "campañas activas"}</span>}
                    {c.paused_by_admin_at && <span className="rounded-full bg-warning/15 px-2 py-0.5 text-warning">Pausada</span>}
                  </div>
                </div>
                {dentro ? (
                  <Button size="sm" variant="outline" className="h-8 shrink-0 gap-1.5" onClick={() => void quitar()} disabled={!!busy}>
                    {busy === "__volver" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />} Quitar
                  </Button>
                ) : (
                  <Button size="sm" className="h-8 shrink-0 gap-1.5" onClick={() => void entrar(c)} disabled={!!busy} aria-label={`Entrar en ${nombreCuenta(c)}`}>
                    {busy === c.id ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Entrando…</> : <><LogIn className="h-3.5 w-3.5" /> Entrar</>}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
        {clients && (
          <p className="border-t px-5 py-2 text-[11.5px] text-muted-foreground">{visibles.length} de {clients.length} cuentas</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
