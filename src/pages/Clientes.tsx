// Clientes del usuario de pago: darles cuenta propia en la plataforma y ver sus
// números por separado.
//
// Un cliente con acceso ES una cuenta normal: entra al mismo producto y trabaja
// con SUS campañas, SUS buzones, SUS leads y SU Unibox, aislados por RLS bajo su
// propio user_id. Lo que se paga es la PLAZA, y lo que envíe cuenta en el plan de
// su dueño — de ahí la línea de consumo de la cabecera, que la suma el servidor.
//
// El TOPE de clientes lo aplica el servidor (edge function `clients`, que
// comprueba public.client_slots_for). Aquí el botón se desactiva cuando no
// quedan plazas, pero la negativa de verdad siempre llega como un 402 de la
// función: nunca se crea nada por confiar en este cálculo.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { useConfirm } from "@/hooks/useConfirm";
import { PLAN_CONFIG, getPlanLimits, useSubscription } from "@/contexts/SubscriptionContext";
import { usePlanUsage } from "@/hooks/usePlanUsage";
import { familyNote, monthlyEmailsLine, usageTone } from "@/lib/plan-usage";
import { extractLogoColor } from "@/lib/logoColor";
import {
  Archive,
  BarChart3,
  Brain,
  Building2,
  Check,
  Copy,
  Eye,
  Image as ImageIcon,
  Inbox,
  KeyRound,
  LayoutDashboard,
  Link2,
  Loader2,
  Mail,
  MessageSquareReply,
  Megaphone,
  Palette,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Upload,
  UserCog,
  Users,
  X,
} from "lucide-react";

type ClientStats = { campaigns: number; sent: number; replied: number };

/** Qué fases están hechas. Lo calcula el SERVIDOR a partir de las columnas
 *  (`setup` en la respuesta de `list`): así nunca hay un "paso 3 de 5" guardado
 *  que se desincronice de la realidad, y la configuración se puede retomar
 *  cuando sea desde cualquier fase. */
export type ClientSetup = {
  datos: boolean;
  acceso: boolean;
  logo: boolean;
  colores: boolean;
  permisos: boolean;
  campanas: boolean;
};

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
  login_email?: string | null;
  allowed_sections?: string[] | null;
  setup?: ClientSetup;
};

/** Las secciones REALES de la aplicación que se le pueden abrir al cliente, con
 *  el mismo icono que llevan en la barra lateral para que se reconozcan de un
 *  vistazo. La lista blanca de verdad está en la edge function `clients` (y en la
 *  BD, en client_routes_for_sections); esta es la misma lista, palabra por
 *  palabra, para no mandar nunca una clave que el servidor vaya a rechazar.
 *
 *  El cliente entra a la aplicación NORMAL: estas secciones son las suyas, con sus
 *  propios datos bajo su propio usuario, no una vista de los del dueño. */
const CLIENT_SECTIONS = [
  {
    key: "dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
    help: "Un resumen con sus totales: leads, enviados, respuestas y rebotes.",
  },
  {
    key: "cuentas",
    label: "Cuentas de email",
    icon: Mail,
    help: "Conecta y gestiona sus propios buzones.",
  },
  {
    key: "campanas",
    label: "Campañas",
    icon: Send,
    help: "Crea sus campañas y ve las cifras de cada una.",
  },
  {
    key: "leads",
    label: "Leads",
    icon: Users,
    help: "Sube y gestiona sus listas.",
  },
  {
    key: "unibox",
    label: "Unibox",
    icon: Inbox,
    help: "Las respuestas que llegan a sus buzones, y responder desde ahí.",
  },
  {
    key: "estadisticas",
    label: "Estadísticas",
    icon: BarChart3,
    help: "La evolución de envíos y respuestas por día.",
  },
  {
    key: "ia",
    label: "IA",
    icon: Brain,
    help: "Cómo la IA ha clasificado sus respuestas: interesados, preguntas, no interesados…",
  },
] as const;

/** Las fases, en orden de recorrido. `key` coincide con el objeto `setup`. */
const PHASES = [
  { key: "datos", label: "Datos", n: 1 },
  { key: "acceso", label: "Acceso", n: 2 },
  { key: "logo", label: "Logo", n: 3 },
  { key: "colores", label: "Colores", n: 4 },
  { key: "permisos", label: "Permisos", n: 5 },
] as const;

type PhaseKey = (typeof PHASES)[number]["key"];
type StepKey = PhaseKey | "final";

/** Contraseña fuerte por defecto. Se genera con crypto cuando existe: una
 *  contraseña de acceso no se saca de Math.random si se puede evitar. */
function generatePassword(length = 16): string {
  const alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789@#%*?+";
  const out: string[] = [];
  const rnd = globalThis.crypto;
  if (rnd?.getRandomValues) {
    const buf = new Uint32Array(length);
    rnd.getRandomValues(buf);
    for (let i = 0; i < length; i++) out.push(alphabet[buf[i] % alphabet.length]);
  } else {
    for (let i = 0; i < length; i++) out.push(alphabet[Math.floor(Math.random() * alphabet.length)]);
  }
  return out.join("");
}

async function copyToClipboard(text: string, what: string) {
  try {
    await navigator.clipboard?.writeText(text);
    toast.success(`${what} copiado`);
  } catch {
    toast.error(`No se pudo copiar. ${what}: ${text}`);
  }
}

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

/** Fila de fichas con lo que ya está hecho de cada cliente. Se lee del `setup`
 *  del servidor, así que refleja el estado real aunque se configure a trozos. */
function SetupChips({ setup }: { setup?: ClientSetup }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {PHASES.map((p) => {
        const done = !!setup?.[p.key];
        const text = `${p.label}: ${done ? "hecho" : "pendiente"}`;
        return (
          <span
            key={p.key}
            aria-label={text}
            title={text}
            className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10.5px] font-semibold ${
              done
                ? "border-primary/30 bg-primary/10 text-primary"
                : "border-border bg-muted/40 text-muted-foreground"
            }`}
          >
            {done && <Check className="h-3 w-3" />}
            {p.label}
          </span>
        );
      })}
    </div>
  );
}

/** El consumo del plan de este mes, sumando al dueño y a sus clientes. Es una
 *  medida: aquí no se bloquea nada, sólo se cuenta lo que dice el servidor. */
function PlanConsumoLine() {
  const { tier, isTrialing } = useSubscription();
  const { usage, loading, error } = usePlanUsage();
  const limit = getPlanLimits(tier, isTrialing).emailsPerMonth;

  if (loading) {
    return (
      <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> Contando los envíos de este mes…
      </p>
    );
  }
  if (error || !usage) {
    return (
      <p className="text-[13px] text-muted-foreground">
        No pudimos leer el consumo de tu plan. Lo verás en <Link to="/settings" className="font-semibold text-primary hover:underline">Configuración</Link>.
      </p>
    );
  }
  const tone = usageTone(usage.enviados, limit);
  const nota = familyNote(usage.cuentas);
  return (
    <p className="text-[13px] text-muted-foreground">
      <span
        className={`font-semibold tabular-nums ${
          tone === "over" ? "text-destructive" : tone === "warn" ? "text-warning" : "text-foreground"
        }`}
      >
        {monthlyEmailsLine(usage.enviados, limit)}
      </span>
      {nota ? ` · ${nota}` : " · Lo que envíen tus clientes cuenta aquí."}
    </p>
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
  // Configuración por fases: se guarda SÓLO el id. El cliente que se pinta sale
  // siempre de la lista recién cargada, así que las fases hechas vienen del
  // servidor y no de lo que esta pantalla crea recordar.
  const [configId, setConfigId] = useState<string | null>(null);
  const configClient = useMemo(() => clients.find((c) => c.id === configId) || null, [clients, configId]);

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
            <p className="text-[13px] text-muted-foreground">Dale cuenta propia a cada cliente.</p>
          )}
          {/* Consumo del plan: esta es la pantalla donde se piensa en clientes, y
              lo que ellos envían gasta este mismo plan. */}
          <PlanConsumoLine />
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
              Dale a cada cliente su propia cuenta en la plataforma y ve sus resultados por separado. Lo que envíen va en
              tu mismo plan.
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
                        <div className="mt-1.5">
                          <SetupChips setup={c.setup} />
                        </div>
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
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 gap-1.5 text-[13px]"
                        aria-label={`Configurar el cliente ${c.name}`}
                        onClick={() => setConfigId(c.id)}
                      >
                        <Settings2 className="h-3.5 w-3.5" /> Configurar
                      </Button>
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

      {/* Configuración por fases */}
      {configClient && (
        <ClientSetupDialog
          client={configClient}
          onClose={() => setConfigId(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}

/** La primera fase que falta — para abrir el panel donde el trabajo se quedó. */
function firstPendingStep(setup?: ClientSetup): StepKey {
  const pending = PHASES.find((p) => !setup?.[p.key]);
  return pending ? pending.key : "final";
}

const STEP_ORDER: StepKey[] = [...PHASES.map((p) => p.key), "final"];

/** Un aviso corto, siempre visible, dentro de una fase. */
function PhaseNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-md border border-border bg-muted/40 p-2.5 text-[13px] text-muted-foreground">{children}</p>
  );
}

function PhaseHeader({ n, title, help }: { n: number | null; title: string; help: string }) {
  return (
    <div className="space-y-1">
      <p className="font-display text-[17px] font-semibold tracking-[-0.03em] text-foreground">
        {n ? `Fase ${n} · ${title}` : title}
      </p>
      <p className="text-[13px] text-muted-foreground">{help}</p>
    </div>
  );
}

/**
 * Configuración por fases de un cliente.
 *
 * No es un formulario largo: son cinco fases que se pueden hacer en cualquier
 * orden, dejar a medias y retomar otro día. El progreso NO se guarda aquí —
 * se lee de `client.setup`, que el servidor deriva de las propias columnas.
 */
function ClientSetupDialog({
  client,
  onClose,
  onChanged,
}: {
  client: ClientRow;
  onClose: () => void;
  onChanged: () => Promise<void> | void;
}) {
  const confirm = useConfirm();
  const setup = client.setup;
  const [step, setStep] = useState<StepKey>(() => firstPendingStep(client.setup));
  const [busy, setBusy] = useState<string | null>(null);

  // Fase 1 · Datos
  const [datos, setDatos] = useState({
    name: client.name || "",
    company_name: client.company_name || "",
    contact_email: client.contact_email || "",
    notes: client.notes || "",
  });
  const [datosError, setDatosError] = useState<string | null>(null);

  // Fase 2 · Acceso
  const [loginEmail, setLoginEmail] = useState(client.contact_email || "");
  const [password, setPassword] = useState(() => generatePassword());
  const [accesoError, setAccesoError] = useState<string | null>(null);
  // La última contraseña puesta en ESTA sesión, para poder copiarla justo después
  // de ponerla. No se guarda en ningún sitio: al cerrar el panel desaparece.
  const [lastPassword, setLastPassword] = useState<string | null>(null);

  // Fase 3 · Logo
  const [logoUrl, setLogoUrl] = useState(client.logo_url || "");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Fase 4 · Colores
  const [color, setColor] = useState(client.brand_color || "#6E58F1");

  // Fase 5 · Permisos
  const [sections, setSections] = useState<string[]>(() => [...(client.allowed_sections || [])]);

  const accessLink = `${window.location.origin}/acceso-cliente`;
  const pending = useMemo(() => PHASES.filter((p) => !setup?.[p.key]), [setup]);
  const goNext = () => {
    const i = STEP_ORDER.indexOf(step);
    setStep(STEP_ORDER[Math.min(i + 1, STEP_ORDER.length - 1)]);
  };

  /** Una sola puerta: llama, refresca la lista y devuelve la respuesta cruda. */
  const run = async (key: string, action: string, payload: Record<string, unknown>) => {
    setBusy(key);
    const res = await callClients(action, payload).catch((e) => ({
      status: 0,
      body: { error: (e as Error).message },
    }));
    setBusy(null);
    if (res.status === 200) await onChanged();
    return res;
  };

  const saveDatos = async () => {
    const name = datos.name.trim();
    if (!name) {
      setDatosError("Pon un nombre para el cliente.");
      return;
    }
    setDatosError(null);
    const { status, body } = await run("datos", "update", {
      id: client.id,
      name,
      company_name: datos.company_name.trim(),
      contact_email: datos.contact_email.trim(),
      notes: datos.notes.trim(),
    });
    if (status === 409) {
      setDatosError(body?.error || "Ya tienes un cliente con ese nombre");
      return;
    }
    if (status !== 200) {
      setDatosError(body?.message || body?.error || "No se pudieron guardar los datos.");
      return;
    }
    toast.success("Datos guardados");
    goNext();
  };

  const createAccess = async () => {
    setAccesoError(null);
    const { status, body } = await run("acceso", "create_login", {
      id: client.id,
      email: loginEmail.trim(),
      password,
      full_name: client.name,
    });
    if (status !== 200) {
      setAccesoError(body?.message || body?.error || "No se pudo crear el acceso.");
      return;
    }
    setLastPassword(password);
    toast.success("Acceso creado");
  };

  const resetPassword = async () => {
    setAccesoError(null);
    const { status, body } = await run("password", "reset_login_password", { id: client.id, password });
    if (status !== 200) {
      setAccesoError(body?.message || body?.error || "No se pudo cambiar la contraseña.");
      return;
    }
    setLastPassword(password);
    toast.success("Contraseña cambiada");
  };

  const removeAccess = async () => {
    const ok = await confirm({
      title: "Quitar el acceso",
      description:
        `La cuenta ${client.login_email || ""} dejará de existir y el cliente ya no podrá entrar. ` +
        "Sus campañas y sus datos no se tocan: puedes volver a crearle acceso cuando quieras.",
      confirmText: "Quitar acceso",
      destructive: true,
    });
    if (!ok) return;
    const { status, body } = await run("quitar", "remove_login", { id: client.id });
    if (status !== 200) {
      setAccesoError(body?.message || body?.error || "No se pudo quitar el acceso.");
      return;
    }
    setLastPassword(null);
    setPassword(generatePassword());
    toast.success("Acceso retirado");
  };

  const uploadLogo = async (file: File) => {
    if (file.size > 3 * 1024 * 1024) {
      toast.error("El logo debe pesar menos de 3 MB");
      return;
    }
    setUploading(true);
    try {
      const ext = (file.name.split(".").pop() || "png").toLowerCase();
      const rand = Math.random().toString(36).slice(2, 10);
      const path = `client-logos/${Date.now()}-${rand}.${ext}`;
      const { error } = await supabase.storage
        .from("godtube-media")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (error) throw error;
      const { data } = supabase.storage.from("godtube-media").getPublicUrl(path);
      setLogoUrl(data.publicUrl);
      // De paso, el color de marca sale del propio logo.
      const hex = await extractLogoColor(file).catch(() => null);
      if (hex) setColor(hex);
      toast.success("Logo subido. Guárdalo para dejarlo fijo.");
    } catch (e) {
      toast.error((e as Error).message || "No se pudo subir el logo");
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const saveLogo = async () => {
    const { status, body } = await run("logo", "update", { id: client.id, logo_url: logoUrl.trim() });
    if (status !== 200) {
      toast.error(body?.message || body?.error || "No se pudo guardar el logo.");
      return;
    }
    toast.success(logoUrl.trim() ? "Logo guardado" : "Logo quitado");
    if (logoUrl.trim()) goNext();
  };

  const colorFromLogo = async () => {
    const src = logoUrl.trim() || client.logo_url || "";
    if (!src) return;
    setBusy("color-logo");
    const hex = await extractLogoColor(src).catch(() => null);
    setBusy(null);
    if (hex) {
      setColor(hex);
      toast.success(`Color del logo: ${hex}`);
    } else toast.error("No pudimos sacar el color de ese logo. Elígelo a mano.");
  };

  const saveColor = async () => {
    const { status, body } = await run("colores", "update", { id: client.id, brand_color: color });
    if (status !== 200) {
      toast.error(body?.message || body?.error || "No se pudo guardar el color.");
      return;
    }
    toast.success("Color guardado");
    goNext();
  };

  const savePermisos = async () => {
    // Sólo se manda lo que existe: si algo no está en la lista, no viaja.
    const clean = sections.filter((s) => CLIENT_SECTIONS.some((x) => x.key === s));
    const { status, body } = await run("permisos", "set_sections", { id: client.id, sections: clean });
    if (status !== 200) {
      toast.error(body?.message || body?.error || "No se pudieron guardar los permisos.");
      return;
    }
    toast.success("Permisos guardados");
    goNext();
  };

  const toggleSection = (key: string) =>
    setSections((s) => (s.includes(key) ? s.filter((x) => x !== key) : [...s, key]));

  const spin = (key: string) => busy === key;

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display tracking-[-0.03em]">Configurar «{client.name}»</DialogTitle>
          <DialogDescription>
            Cinco fases. Puedes hacerlas en el orden que quieras, dejarlo a medias y volver: lo hecho se queda hecho.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 sm:grid-cols-[190px_1fr]">
          {/* Navegación de fases */}
          <nav aria-label="Fases de configuración" className="flex flex-row flex-wrap gap-1 sm:flex-col">
            {PHASES.map((p) => {
              const done = !!setup?.[p.key];
              const active = step === p.key;
              return (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => setStep(p.key)}
                  aria-current={active ? "step" : undefined}
                  className={`flex items-center gap-2 rounded-md border px-2.5 py-2 text-left text-[13px] font-semibold transition-colors ${
                    active ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-card text-foreground hover:bg-muted/50"
                  }`}
                >
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[10.5px] ${
                      done ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {done ? <Check className="h-3 w-3" /> : p.n}
                  </span>
                  {p.label}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setStep("final")}
              aria-current={step === "final" ? "step" : undefined}
              className={`flex items-center gap-2 rounded-md border px-2.5 py-2 text-left text-[13px] font-semibold transition-colors ${
                step === "final" ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-card text-foreground hover:bg-muted/50"
              }`}
            >
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                <ShieldCheck className="h-3 w-3" />
              </span>
              Resumen
            </button>
          </nav>

          {/* Contenido de la fase */}
          <div className="min-w-0 space-y-4">
            {step === "datos" && (
              <>
                <PhaseHeader n={1} title="Datos" help="Quién es el cliente. Solo el nombre es obligatorio." />
                <div className="space-y-1">
                  <Label htmlFor="fase1-nombre">Nombre</Label>
                  <Input
                    id="fase1-nombre"
                    value={datos.name}
                    aria-invalid={!!datosError}
                    onChange={(e) => { setDatos({ ...datos, name: e.target.value }); setDatosError(null); }}
                  />
                  {datosError && <p className="text-[13px] font-semibold text-destructive">{datosError}</p>}
                </div>
                <div className="space-y-1">
                  <Label htmlFor="fase1-empresa">Empresa</Label>
                  <Input
                    id="fase1-empresa"
                    value={datos.company_name}
                    onChange={(e) => setDatos({ ...datos, company_name: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="fase1-email">Email de contacto</Label>
                  <Input
                    id="fase1-email"
                    type="email"
                    value={datos.contact_email}
                    onChange={(e) => setDatos({ ...datos, contact_email: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="fase1-notas">Notas</Label>
                  <Textarea
                    id="fase1-notas"
                    rows={3}
                    value={datos.notes}
                    onChange={(e) => setDatos({ ...datos, notes: e.target.value })}
                  />
                </div>
                <Button onClick={saveDatos} disabled={spin("datos")} className="gap-2">
                  {spin("datos") && <Loader2 className="h-4 w-4 animate-spin" />} Guardar datos
                </Button>
              </>
            )}

            {step === "acceso" && (
              <>
                <PhaseHeader
                  n={2}
                  title="Acceso"
                  help="La cuenta con la que el cliente entra a la plataforma. Es una cuenta normal: trabaja con sus propios datos, y sólo ve las secciones que le abras en la fase 5."
                />
                {client.login_email ? (
                  <>
                    <div className="rounded-md border border-border bg-card p-3 shadow-rest">
                      <p className="text-[13px] text-muted-foreground">El cliente ya puede entrar con</p>
                      <p className="mt-0.5 flex items-center gap-2 break-all font-mono text-[15px] font-semibold text-foreground">
                        {client.login_email}
                        <button
                          type="button"
                          aria-label="Copiar el email de acceso"
                          className="text-muted-foreground hover:text-primary"
                          onClick={() => copyToClipboard(client.login_email || "", "Email")}
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                      </p>
                    </div>
                    {lastPassword && (
                      <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
                        <p className="text-[13px] font-semibold text-foreground">
                          Esta es la contraseña que acabas de poner. Cópiala ahora: no la guardamos.
                        </p>
                        <p className="mt-1 flex items-center gap-2 break-all font-mono text-[15px] text-foreground">
                          {lastPassword}
                          <button
                            type="button"
                            aria-label="Copiar la contraseña"
                            className="text-muted-foreground hover:text-primary"
                            onClick={() => copyToClipboard(lastPassword, "Contraseña")}
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                        </p>
                      </div>
                    )}
                    <div className="space-y-2">
                      <Label htmlFor="fase2-nueva">Cambiar contraseña</Label>
                      <div className="flex flex-wrap items-center gap-2">
                        <Input id="fase2-nueva" className="w-56 font-mono" value={password} onChange={(e) => setPassword(e.target.value)} />
                        <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => setPassword(generatePassword())}>
                          <RefreshCw className="h-3.5 w-3.5" /> Generar otra
                        </Button>
                        <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => copyToClipboard(password, "Contraseña")}>
                          <Copy className="h-3.5 w-3.5" /> Copiar
                        </Button>
                      </div>
                      <PhaseNote>
                        No la guardamos en ningún sitio: si el cliente la pierde, le pones una nueva desde aquí.
                      </PhaseNote>
                      <Button onClick={resetPassword} disabled={spin("password") || password.length < 8} className="gap-2">
                        {spin("password") && <Loader2 className="h-4 w-4 animate-spin" />} Cambiar contraseña
                      </Button>
                    </div>
                    {accesoError && <p className="text-[13px] font-semibold text-destructive">{accesoError}</p>}
                    <div className="border-t border-border pt-3">
                      <Button variant="outline" size="sm" className="gap-1.5 text-destructive" onClick={removeAccess} disabled={spin("quitar")}>
                        {spin("quitar") ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />} Quitar acceso
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="space-y-1">
                      <Label htmlFor="fase2-email">Email de acceso</Label>
                      <Input
                        id="fase2-email"
                        type="email"
                        value={loginEmail}
                        onChange={(e) => { setLoginEmail(e.target.value); setAccesoError(null); }}
                        placeholder="ana@verasalud.com"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="fase2-pass">Contraseña</Label>
                      <div className="flex flex-wrap items-center gap-2">
                        <Input
                          id="fase2-pass"
                          className="w-56 font-mono"
                          value={password}
                          onChange={(e) => { setPassword(e.target.value); setAccesoError(null); }}
                        />
                        <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => setPassword(generatePassword())}>
                          <RefreshCw className="h-3.5 w-3.5" /> Generar otra
                        </Button>
                        <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => copyToClipboard(password, "Contraseña")}>
                          <Copy className="h-3.5 w-3.5" /> Copiar
                        </Button>
                      </div>
                    </div>
                    <PhaseNote>
                      Cópiala y mándasela al cliente: <strong>no la guardamos</strong> en ningún sitio. Si se pierde, le
                      pones una nueva desde aquí — nadie puede recuperarla.
                    </PhaseNote>
                    {accesoError && <p className="text-[13px] font-semibold text-destructive">{accesoError}</p>}
                    <Button onClick={createAccess} disabled={spin("acceso")} className="gap-2">
                      {spin("acceso") ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />} Crear acceso
                    </Button>
                  </>
                )}
              </>
            )}

            {step === "logo" && (
              <>
                <PhaseHeader n={3} title="Logo" help="El logo del cliente. Lo verá en la barra lateral al entrar." />
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    aria-label="Archivo de logo"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadLogo(f); }}
                  />
                  <Button type="button" variant="outline" size="sm" className="gap-1.5" disabled={uploading} onClick={() => fileRef.current?.click()}>
                    {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Subir archivo
                  </Button>
                  {logoUrl ? (
                    <img src={logoUrl} alt="Logo del cliente" className="h-10 max-w-[140px] rounded-md border border-border object-contain" />
                  ) : (
                    <span className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-muted/40 text-muted-foreground">
                      <ImageIcon className="h-4 w-4" />
                    </span>
                  )}
                </div>
                <div className="space-y-1">
                  <Label htmlFor="fase3-url">…o pega la dirección de una imagen</Label>
                  <Input id="fase3-url" value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://…/logo.png" />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button onClick={saveLogo} disabled={spin("logo") || uploading} className="gap-2">
                    {spin("logo") && <Loader2 className="h-4 w-4 animate-spin" />} Guardar logo
                  </Button>
                  {logoUrl && (
                    <Button variant="outline" size="sm" onClick={() => setLogoUrl("")} disabled={spin("logo")}>
                      Quitar
                    </Button>
                  )}
                </div>
              </>
            )}

            {step === "colores" && (
              <>
                <PhaseHeader n={4} title="Colores" help="El color con el que se le pinta la plataforma. Así la ve él." />
                <div className="flex flex-wrap items-end gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="fase4-color">Color de marca</Label>
                    <div className="flex items-center gap-2">
                      <input
                        id="fase4-color"
                        type="color"
                        value={/^#[0-9a-fA-F]{6}$/.test(color) ? color : "#6E58F1"}
                        onChange={(e) => setColor(e.target.value.toUpperCase())}
                        className="h-9 w-12 cursor-pointer rounded-md border border-border bg-background"
                      />
                      <Input value={color} onChange={(e) => setColor(e.target.value)} className="w-28 font-mono" />
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    disabled={!(logoUrl.trim() || client.logo_url) || spin("color-logo")}
                    onClick={colorFromLogo}
                  >
                    {spin("color-logo") ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Palette className="h-3.5 w-3.5" />} Sacar del logo
                  </Button>
                </div>
                {/* Vista previa de su área, con su color */}
                <div className="overflow-hidden rounded-md border border-border shadow-rest">
                  <div className="flex items-center gap-2 border-b border-border bg-card px-3 py-2">
                    {logoUrl ? (
                      <img src={logoUrl} alt="" className="h-6 max-w-[90px] object-contain" />
                    ) : (
                      <span className="flex h-6 w-6 items-center justify-center rounded-md" style={{ background: `${color}1a`, color }}>
                        <Building2 className="h-3 w-3" />
                      </span>
                    )}
                    <span className="text-[13px] font-semibold text-foreground">{client.company_name || client.name}</span>
                    <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                      <Eye className="h-3 w-3" /> Vista previa
                    </span>
                  </div>
                  <div className="space-y-2 bg-background p-3">
                    <div className="flex gap-2">
                      <span className="rounded-md border border-border bg-card px-2 py-1 text-[12px] font-semibold text-muted-foreground">
                        Enviados <span className="tabular-nums text-foreground">1.240</span>
                      </span>
                      <span className="rounded-md border px-2 py-1 text-[12px] font-semibold" style={{ borderColor: `${color}55`, background: `${color}14`, color }}>
                        Respuestas <span className="tabular-nums">37</span>
                      </span>
                    </div>
                    <span className="inline-flex rounded-md px-3 py-1.5 text-[13px] font-semibold text-white" style={{ background: color }}>
                      Así se ven sus botones
                    </span>
                  </div>
                </div>
                <Button onClick={saveColor} disabled={spin("colores")} className="gap-2">
                  {spin("colores") && <Loader2 className="h-4 w-4 animate-spin" />} Guardar color
                </Button>
              </>
            )}

            {step === "permisos" && (
              <>
                <PhaseHeader
                  n={5}
                  title="Qué puede ver"
                  help="Marca las secciones de la plataforma que quieres abrirle. Trabajará en ellas con sus propios datos; todo lo demás no existe para él."
                />
                <div className="space-y-2">
                  {CLIENT_SECTIONS.map((s) => {
                    const on = sections.includes(s.key);
                    return (
                      <label
                        key={s.key}
                        htmlFor={`fase5-${s.key}`}
                        className={`flex cursor-pointer items-start gap-2.5 rounded-md border p-2.5 transition-colors ${
                          on ? "border-primary/40 bg-primary/5" : "border-border hover:bg-muted/40"
                        }`}
                      >
                        <Checkbox
                          id={`fase5-${s.key}`}
                          className="mt-0.5"
                          checked={on}
                          onCheckedChange={() => toggleSection(s.key)}
                        />
                        <span
                          aria-hidden="true"
                          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${
                            on ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                          }`}
                        >
                          <s.icon className="h-4 w-4" strokeWidth={1.9} />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-[15px] font-semibold text-foreground">{s.label}</span>
                          <span className="block text-[13px] text-muted-foreground">{s.help}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
                {sections.length === 0 && (
                  <PhaseNote>Sin ninguna marcada, el cliente entra y no ve nada. Marca al menos una.</PhaseNote>
                )}
                <Button onClick={savePermisos} disabled={spin("permisos")} className="gap-2">
                  {spin("permisos") && <Loader2 className="h-4 w-4 animate-spin" />} Guardar permisos
                </Button>
              </>
            )}

            {step === "final" && (
              <>
                <PhaseHeader n={null} title="Resumen" help="Lo que queda por hacer, y el enlace que le mandas al cliente." />
                {pending.length === 0 ? (
                  <div className="rounded-md border border-success/40 bg-success/10 p-3">
                    <p className="flex items-center gap-1.5 font-display text-[15px] font-semibold tracking-[-0.02em] text-foreground">
                      <Check className="h-4 w-4 text-success" /> Todo listo: {client.name} ya está conectado
                    </p>
                    <p className="mt-1 text-[13px] text-muted-foreground">
                      Entra con <span className="font-mono text-foreground">{client.login_email}</span> y ve
                      {" "}
                      {(client.allowed_sections || []).length} sección
                      {(client.allowed_sections || []).length === 1 ? "" : "es"} de la plataforma.
                    </p>
                  </div>
                ) : (
                  <div className="rounded-md border border-warning/40 bg-warning/10 p-3">
                    <p className="font-display text-[15px] font-semibold tracking-[-0.02em] text-foreground">
                      Todavía falta {pending.length === 1 ? "una fase" : `${pending.length} fases`}
                    </p>
                    <ul className="mt-1.5 space-y-1">
                      {pending.map((p) => (
                        <li key={p.key} className="text-[13px] text-muted-foreground">
                          <button type="button" className="font-semibold text-primary hover:underline" onClick={() => setStep(p.key)}>
                            Fase {p.n} · {p.label}
                          </button>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 text-[13px] text-muted-foreground">
                      Puedes dejarlo aquí y seguir otro día: lo guardado no se pierde.
                    </p>
                  </div>
                )}

                {/* Qué es, exactamente, lo que el cliente se lleva. */}
                <PhaseNote>
                  Entra en la plataforma con su cuenta y trabaja con sus propias campañas, buzones y respuestas; lo que
                  envíe cuenta en tu plan.
                </PhaseNote>

                <div className="space-y-1">
                  <Label htmlFor="fase-final-enlace">Enlace de acceso del cliente</Label>
                  <div className="flex flex-wrap items-center gap-2">
                    <Input id="fase-final-enlace" readOnly value={accessLink} className="max-w-xs font-mono text-[13px]" />
                    <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => copyToClipboard(accessLink, "Enlace")}>
                      <Copy className="h-3.5 w-3.5" /> Copiar enlace
                    </Button>
                  </div>
                  <p className="text-[13px] text-muted-foreground">
                    <Link2 className="mr-1 inline h-3.5 w-3.5" />
                    Entra ahí con su email y su contraseña y aterriza directamente en la plataforma.
                  </p>
                </div>

                {!setup?.campanas && (
                  <PhaseNote>
                    <UserCog className="mr-1 inline h-3.5 w-3.5" />
                    Aún no tiene ninguna campaña asignada. Se hace desde las opciones de cada campaña, y entonces
                    empezará a ver cifras.
                  </PhaseNote>
                )}
              </>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={!!busy}>
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
