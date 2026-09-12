// Clientes del usuario de pago: agrupar campañas por cliente y ver sus números
// por separado. Un cliente NO es una cuenta aparte — vive dentro de esta cuenta
// (tabla `clients`), así que sus envíos van en el mismo plan.
//
// El TOPE de clientes lo aplica el servidor (edge function `clients`, que
// comprueba public.client_slots_for). Aquí el botón se desactiva cuando no
// quedan plazas, pero la negativa de verdad siempre llega como un 402 de la
// función: nunca se crea nada por confiar en este cálculo.
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { useConfirm } from "@/hooks/useConfirm";
import { PLAN_CONFIG } from "@/contexts/SubscriptionContext";
import {
  Archive,
  Building2,
  Loader2,
  MessageSquareReply,
  Megaphone,
  Pencil,
  Plus,
  Send,
  Settings2,
  Sparkles,
  X,
} from "lucide-react";

type ClientStats = { campaigns: number; sent: number; replied: number };

export type ClientRow = {
  id: string;
  name: string;
  company_name: string | null;
  contact_email: string | null;
  logo_url: string | null;
  brand_color: string | null;
  notes: string | null;
  created_at: string;
  stats?: ClientStats;
};

export type ClientUsage = {
  slots: number;
  used: number;
  remaining: number;
  tier: string;
  status: string;
  extra_slots: number;
  extra_slot_price_usd: number;
  can_buy_slots: boolean;
};

const tierLabel = (tier: string) =>
  (PLAN_CONFIG as Record<string, { label: string }>)[tier]?.label || "Gratuito";

/** Una sola puerta al servidor: devuelve el STATUS además del cuerpo, porque el
 *  tope (402) y la plaza aún sin precio (501) se distinguen por código. */
async function callClients(action: string, payload: Record<string, unknown> = {}) {
  const { data } = await supabase.auth.getSession();
  const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/clients`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${data?.session?.access_token || ""}`,
    },
    body: JSON.stringify({ action, ...payload }),
  });
  let body: any = {};
  try {
    body = await resp.json();
  } catch {
    body = {};
  }
  return { status: resp.status, body };
}

const emptyForm = { name: "", company_name: "", contact_email: "", notes: "" };

function Stat({ value, label, className }: { value: number; label: string; className: string }) {
  return (
    <span className="inline-flex items-baseline gap-1 whitespace-nowrap">
      <span className={`text-[15px] font-semibold tabular-nums ${className}`}>{value}</span>
      <span className="text-[13px] text-muted-foreground">{label}</span>
    </span>
  );
}

export default function Clientes() {
  const confirm = useConfirm();
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [usage, setUsage] = useState<ClientUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Panel del 402: el plan no da para más clientes.
  const [capBlock, setCapBlock] = useState<{ message: string } | null>(null);
  const [slotNotice, setSlotNotice] = useState<string | null>(null);
  const [buying, setBuying] = useState(false);
  // Diálogo de crear/editar
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ClientRow | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [nameError, setNameError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    const { status, body } = await callClients("list").catch((e) => ({
      status: 0,
      body: { error: (e as Error).message },
    }));
    if (status !== 200) {
      setLoadError(body?.message || body?.error || "No pudimos cargar tus clientes.");
      setLoading(false);
      return;
    }
    setClients(body.clients || []);
    setUsage(body.usage || null);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setNameError(null);
    setDialogOpen(true);
  };

  const openEdit = (c: ClientRow) => {
    setEditing(c);
    setForm({
      name: c.name || "",
      company_name: c.company_name || "",
      contact_email: c.contact_email || "",
      notes: c.notes || "",
    });
    setNameError(null);
    setDialogOpen(true);
  };

  const submit = async () => {
    const name = form.name.trim();
    if (!name) {
      setNameError("Pon un nombre para el cliente.");
      return;
    }
    setSaving(true);
    setNameError(null);
    const payload = {
      name,
      company_name: form.company_name.trim(),
      contact_email: form.contact_email.trim(),
      notes: form.notes.trim(),
    };
    const { status, body } = await callClients(
      editing ? "update" : "create",
      editing ? { id: editing.id, ...payload } : payload,
    ).catch((e) => ({ status: 0, body: { error: (e as Error).message } }));
    setSaving(false);

    if (status === 409) {
      // El nombre repetido se dice EN EL CAMPO, no en un toast que se va.
      setNameError(body?.error || "Ya tienes un cliente con ese nombre");
      return;
    }
    if (status === 402) {
      // El tope lo decide el servidor: aquí solo se explica y se ofrece salida.
      setDialogOpen(false);
      setSlotNotice(null);
      setCapBlock({ message: body?.message || "Tu plan no incluye más clientes." });
      if (body?.usage) setUsage(body.usage);
      return;
    }
    if (status !== 200) {
      toast.error(body?.message || body?.error || "No se pudo guardar el cliente.");
      return;
    }
    toast.success(editing ? "Cliente actualizado" : `Cliente «${name}» creado`);
    setDialogOpen(false);
    setCapBlock(null);
    load();
  };

  const archive = async (c: ClientRow) => {
    const ok = await confirm({
      title: `Archivar «${c.name}»`,
      description:
        "Dejará de aparecer en la lista y su plaza queda libre. Sus campañas NO se borran: simplemente se quedan sin cliente.",
      confirmText: "Archivar",
      destructive: true,
    });
    if (!ok) return;
    const { status, body } = await callClients("archive", { id: c.id }).catch((e) => ({
      status: 0,
      body: { error: (e as Error).message },
    }));
    if (status !== 200) {
      toast.error(body?.message || body?.error || "No se pudo archivar el cliente.");
      return;
    }
    toast.success(`«${c.name}» archivado`);
    if (body?.usage) setUsage(body.usage);
    load();
  };

  const buySlot = async () => {
    const price = usage?.extra_slot_price_usd ?? 15;
    const ok = await confirm({
      title: "Añadir una plaza de cliente",
      description:
        `Se añadirá 1 plaza a tu suscripción por ${price} $ más al mes.\n\n` +
        "Es un cargo que se repite cada mes mientras tengas la plaza, prorrateado en la factura de este mes. " +
        "Puedes quitarla cuando quieras desde «Gestionar suscripción».",
      confirmText: "Sí, añadir plaza",
    });
    if (!ok) return;
    setBuying(true);
    const { status, body } = await callClients("add_slots", { quantity: 1 }).catch((e) => ({
      status: 0,
      body: { error: (e as Error).message },
    }));
    setBuying(false);

    if (status === 501) {
      // Nada de fingir que funcionó: la plaza todavía no se puede comprar.
      setSlotNotice(
        "Las plazas extra aún no están a la venta: nos falta terminar de configurar el cobro. " +
          "Escríbenos a soporte y te la activamos a mano.",
      );
      return;
    }
    if (status === 409) {
      setSlotNotice(
        body?.message || "Necesitas una suscripción activa para añadir plazas. Elige un plan primero.",
      );
      return;
    }
    if (status !== 200) {
      setSlotNotice(body?.message || body?.error || "No se pudo añadir la plaza.");
      return;
    }
    setSlotNotice(null);
    setCapBlock(null);
    toast.success(`Plaza añadida · ${price} $/mes`);
    if (body?.usage) setUsage(body.usage);
    load();
  };

  const remaining = usage?.remaining ?? 0;
  const atCap = !!usage && remaining <= 0;
  const capReason =
    usage && usage.slots === 0
      ? `El plan ${tierLabel(usage.tier)} no incluye clientes. Sube a Growth (5) o Scale (10).`
      : `Has usado las ${usage?.slots ?? 0} plazas de cliente de tu plan.`;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Cabecera */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-[-0.03em] sm:text-2xl">Clientes</h1>
          {usage ? (
            <p className="text-[13px] text-muted-foreground">
              {usage.used} de {usage.slots} clientes · plan {tierLabel(usage.tier)}
              {usage.extra_slots > 0 && ` · ${usage.extra_slots} plaza${usage.extra_slots === 1 ? "" : "s"} extra`}
            </p>
          ) : (
            <p className="text-[13px] text-muted-foreground">Agrupa tus campañas por cliente.</p>
          )}
        </div>
        {atCap ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className="self-end sm:self-auto"
                tabIndex={0}
                title={`${capReason} Archiva uno o añade una plaza para crear otro.`}
              >
                <Button size="sm" className="gap-2" disabled>
                  <Plus className="h-4 w-4" /> Añadir cliente
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>{`${capReason} Archiva uno o añade una plaza para crear otro.`}</TooltipContent>
          </Tooltip>
        ) : (
          <Button size="sm" className="gap-2 self-end sm:self-auto" onClick={openCreate}>
            <Plus className="h-4 w-4" /> Añadir cliente
          </Button>
        )}
      </div>

      {loadError && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4">
          <p className="text-[15px] font-semibold text-destructive">No pudimos cargar tus clientes</p>
          <p className="mt-1 text-[13px] text-muted-foreground">{loadError}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => { setLoading(true); load(); }}>
            Reintentar
          </Button>
        </div>
      )}

      {/* Panel del 402 — la negativa viene del servidor, no de esta pantalla */}
      {capBlock && (
        <div className="rounded-md border border-warning/40 bg-warning/10 p-4 shadow-rest">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-display text-[15px] font-semibold tracking-[-0.02em] text-foreground">
                Tu plan no incluye más clientes
              </p>
              <p className="mt-1 text-[13px] text-muted-foreground">{capBlock.message}</p>
              <p className="mt-1 text-[13px] text-muted-foreground">
                Puedes subir de plan o añadir una plaza suelta. Los envíos de tus clientes siguen yendo en tu mismo plan.
              </p>
              {slotNotice && (
                <p className="mt-2 rounded-md border border-border bg-card p-2 text-[13px] text-foreground">
                  {slotNotice}
                </p>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button asChild size="sm" className="gap-2">
                  <Link to="/settings">
                    <Sparkles className="h-4 w-4" /> Mejorar plan
                  </Link>
                </Button>
                {usage?.can_buy_slots && (
                  <Button variant="outline" size="sm" className="gap-2" disabled={buying} onClick={buySlot}>
                    {buying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                    Añadir plaza por {usage.extra_slot_price_usd} $/mes
                  </Button>
                )}
              </div>
            </div>
            <button
              type="button"
              aria-label="Cerrar el aviso del plan"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => { setCapBlock(null); setSlotNotice(null); }}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Si la carga falló no sabemos si hay clientes o no, así que el panel de
          error se explica solo: mostrar además "aún no tienes clientes" sería
          afirmar algo que no consta. */}
      {loadError ? null : clients.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Building2 className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
            <h3 className="mb-2 font-display font-semibold tracking-[-0.03em]">Aún no tienes clientes</h3>
            <p className="mx-auto max-w-md text-[15px] text-muted-foreground">
              Agrupa campañas por cliente para ver sus resultados por separado. Los envíos de tus clientes van en tu
              mismo plan.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border bg-card shadow-rest">
          <table className="w-full min-w-[720px] border-collapse text-[15px]">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th scope="col" className="px-4 py-2.5 text-left">
                  <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-muted-foreground">
                    <Building2 className="h-3.5 w-3.5" /> Cliente
                  </span>
                </th>
                <th scope="col" className="px-4 py-2.5 text-left">
                  <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-muted-foreground">
                    <Megaphone className="h-3.5 w-3.5" /> Campañas
                  </span>
                </th>
                <th scope="col" className="px-4 py-2.5 text-left">
                  <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-muted-foreground">
                    <Send className="h-3.5 w-3.5" /> Enviados
                  </span>
                </th>
                <th scope="col" className="px-4 py-2.5 text-left">
                  <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-muted-foreground">
                    <MessageSquareReply className="h-3.5 w-3.5" /> Respuestas
                  </span>
                </th>
                <th scope="col" className="px-4 py-2.5 text-right">
                  <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-muted-foreground">
                    <Settings2 className="h-3.5 w-3.5" /> Acciones
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.id} className="border-b border-border/60 last:border-b-0">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[13px] font-semibold text-white"
                        style={{ backgroundColor: c.brand_color || "hsl(var(--primary))" }}
                      >
                        {c.name.charAt(0).toUpperCase()}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-[15px] font-semibold text-foreground">{c.name}</p>
                        <p className="truncate text-[13px] text-muted-foreground">
                          {[c.company_name, c.contact_email].filter(Boolean).join(" · ") || "Sin datos de contacto"}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Stat value={c.stats?.campaigns ?? 0} label="campañas" className="text-violet-600 dark:text-violet-400" />
                  </td>
                  <td className="px-4 py-3">
                    <Stat value={c.stats?.sent ?? 0} label="enviados" className="text-indigo-600 dark:text-indigo-400" />
                  </td>
                  <td className="px-4 py-3">
                    <Stat value={c.stats?.replied ?? 0} label="respuestas" className="text-teal-600 dark:text-teal-400" />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        aria-label={`Editar el cliente ${c.name}`}
                        title="Editar"
                        onClick={() => openEdit(c)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        aria-label={`Archivar el cliente ${c.name}`}
                        title="Archivar"
                        onClick={() => archive(c)}
                      >
                        <Archive className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Crear / editar */}
      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!saving) setDialogOpen(o); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display tracking-[-0.03em]">
              {editing ? `Editar «${editing.name}»` : "Añadir cliente"}
            </DialogTitle>
            <DialogDescription>
              Solo el nombre es obligatorio. Después podrás asignarle campañas desde las opciones de cada campaña.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="cliente-nombre">Nombre</Label>
              <Input
                id="cliente-nombre"
                value={form.name}
                aria-invalid={!!nameError}
                onChange={(e) => { setForm({ ...form, name: e.target.value }); setNameError(null); }}
                placeholder="Clínica Vera"
              />
              {nameError && <p className="text-[13px] font-semibold text-destructive">{nameError}</p>}
            </div>
            <div className="space-y-1">
              <Label htmlFor="cliente-empresa">Empresa</Label>
              <Input
                id="cliente-empresa"
                value={form.company_name}
                onChange={(e) => setForm({ ...form, company_name: e.target.value })}
                placeholder="Vera Salud S.L."
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cliente-email">Email de contacto</Label>
              <Input
                id="cliente-email"
                type="email"
                value={form.contact_email}
                onChange={(e) => setForm({ ...form, contact_email: e.target.value })}
                placeholder="ana@verasalud.com"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cliente-notas">Notas</Label>
              <Textarea
                id="cliente-notas"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Qué vende, a quién y cualquier cosa que convenga recordar."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button onClick={submit} disabled={saving || !form.name.trim()} className="gap-2">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {editing ? "Guardar cambios" : "Crear cliente"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
