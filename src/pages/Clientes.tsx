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
import { BRAND_SWATCHES, HEX_RE, callClients, uploadBrandLogo, type AgencyBranding } from "@/lib/clients-api";
import { agencyLoginUrl } from "@/lib/client-access";
import { enterClient } from "@/lib/impersonation";
import { cn } from "@/lib/utils";
import { AgencyBrandCard } from "@/components/clients/AgencyBrandCard";
import { CoBrand } from "@/components/clients/CoBrand";
import { rowToAgency } from "@/hooks/useAgencyBrand";
import { brandBarHsl } from "@/lib/brandColor";
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
  ImagePlus,
  Info,
  ExternalLink,
  User,
  Settings2,
  ShieldCheck,
  Sparkles,
  Upload,
  UserCog,
  Users,
  X,
  LogIn,
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
  /** Cuenta de acceso del cliente (si se le ha creado): con ella se puede entrar sin contraseña. */
  login_user_id?: string | null;
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

const emptyForm = { name: "", company_name: "", contact_email: "", notes: "", logo_url: "", brand_color: "" };

/** Sube el logo de un cliente (mismo almacén que el resto de logos). */
const uploadClientLogo = (file: File) => uploadBrandLogo(file, "client-logos");

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
  const { tier, isTrialing, customPlan } = useSubscription();
  const { usage, loading, error } = usePlanUsage();
  const limit = getPlanLimits(tier, isTrialing, customPlan).emailsPerMonth;

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
  const [logoBusy, setLogoBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const pickLogo = async (file: File | null | undefined) => {
    if (!file) return;
    setLogoBusy(true);
    try {
      const { url, color } = await uploadClientLogo(file);
      setForm((f) => ({ ...f, logo_url: url, brand_color: color || f.brand_color }));
      toast.success(color ? `Logo subido · color de marca ${color}` : "Logo subido");
    } catch (e) {
      toast.error((e as Error).message || "No se pudo subir el logo");
    }
    setLogoBusy(false);
    if (logoInputRef.current) logoInputRef.current.value = "";
  };
  const colorFromFormLogo = async () => {
    if (!form.logo_url) return;
    setLogoBusy(true);
    const hex = await extractLogoColor(form.logo_url).catch(() => null);
    setLogoBusy(false);
    if (hex) setForm((f) => ({ ...f, brand_color: hex }));
    else toast.error("No pudimos sacar el color de ese logo. Elígelo a mano.");
  };
  // Configuración por fases: se guarda SÓLO el id. El cliente que se pinta sale
  // siempre de la lista recién cargada, así que las fases hechas vienen del
  // servidor y no de lo que esta pantalla crea recordar.
  const [configId, setConfigId] = useState<string | null>(null);
  // Entrar en la cuenta de un cliente sin contraseña (12-11-2026). La función comprueba que es tuyo.
  const [entrando, setEntrando] = useState<string | null>(null);
  const entrarEnCliente = async (c: ClientRow) => {
    if (!c.login_user_id || entrando) return;
    setEntrando(c.id);
    try { await enterClient(c.login_user_id); }
    catch (e) { toast.error((e as Error).message || "No se pudo entrar en su cuenta"); setEntrando(null); }
  };
  // Marca de la agencia (su entrada exclusiva para clientes): la carga la tarjeta de arriba.
  const [agency, setAgency] = useState<AgencyBranding | null>(null);
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
      logo_url: c.logo_url || "",
      brand_color: c.brand_color || "",
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
      logo_url: form.logo_url.trim(),
      brand_color: HEX_RE.test(form.brand_color.trim()) ? form.brand_color.trim().toUpperCase() : "",
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
      ? `El plan ${tierLabel(usage.tier)} no incluye clientes. Sube a Growth (5) o Pack Agency (10).`
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

      {/* Tu marca de agencia: lo que ven tus clientes en su entrada exclusiva */}
      <AgencyBrandCard onLoaded={setAgency} />

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
                      {c.login_user_id && (
                        <Button
                          size="sm"
                          className="h-8 gap-1.5 text-[13px]"
                          aria-label={`Entrar en la cuenta de ${c.name}`}
                          title="Entrar en su cuenta sin contraseña"
                          disabled={entrando !== null}
                          onClick={() => void entrarEnCliente(c)}
                        >
                          {entrando === c.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogIn className="h-3.5 w-3.5" />} Entrar
                        </Button>
                      )}
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
        <DialogContent className="max-h-[92dvh] max-w-md overflow-y-auto">
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
            {/* Marca del cliente: su logo y su color (así verá la plataforma al entrar) */}
            <div className="space-y-2 rounded-xl border border-border bg-muted/30 p-3">
              <div className="flex items-center justify-between">
                <Label className="text-[13.5px]">Logo y color de marca</Label>
                <span className="text-[11.5px] text-muted-foreground">Opcional</span>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => logoInputRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => { e.preventDefault(); setDragOver(false); void pickLogo(e.dataTransfer.files?.[0]); }}
                  disabled={logoBusy}
                  aria-label={form.logo_url ? "Cambiar el logo" : "Subir el logo"}
                  className={`relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border-2 border-dashed transition-colors ${
                    dragOver ? "border-primary bg-primary/10" : "border-border bg-background hover:border-primary/60"
                  }`}
                >
                  {logoBusy ? (
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  ) : form.logo_url ? (
                    <img src={form.logo_url} alt="Logo del cliente" className="h-full w-full object-contain p-1.5" />
                  ) : (
                    <ImagePlus className="h-5 w-5 text-muted-foreground" />
                  )}
                </button>
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/svg+xml,image/webp"
                  className="hidden"
                  aria-label="Archivo de logo"
                  onChange={(e) => void pickLogo(e.target.files?.[0])}
                />
                <div className="min-w-0 flex-1 text-[12.5px] leading-snug text-muted-foreground">
                  {form.logo_url ? (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <button type="button" className="font-semibold text-primary hover:underline" onClick={() => logoInputRef.current?.click()} disabled={logoBusy}>Cambiar</button>
                      <button type="button" className="font-semibold text-muted-foreground hover:text-foreground" onClick={() => setForm({ ...form, logo_url: "" })} disabled={logoBusy}>Quitar</button>
                      <button type="button" className="inline-flex items-center gap-1 font-semibold text-muted-foreground hover:text-foreground" onClick={colorFromFormLogo} disabled={logoBusy}>
                        <Palette className="h-3 w-3" /> Color del logo
                      </button>
                    </div>
                  ) : (
                    <>Pulsa o arrastra su logo (PNG, JPG, SVG · máx. 3 MB). Sacamos su color solo.</>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Color de marca">
                {BRAND_SWATCHES.map((c) => {
                  const on = form.brand_color.toUpperCase() === c;
                  return (
                    <button
                      key={c}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      aria-label={`Color ${c}`}
                      onClick={() => setForm({ ...form, brand_color: c })}
                      className={`h-6 w-6 rounded-full border border-black/10 transition-transform hover:scale-110 ${on ? "ring-2 ring-offset-2 ring-offset-background" : ""}`}
                      style={{ background: c, ...(on ? { boxShadow: `0 0 0 2px ${c}` } : {}) }}
                    />
                  );
                })}
                <label className="ml-1 inline-flex items-center gap-1.5">
                  <input
                    type="color"
                    aria-label="Elegir otro color"
                    value={HEX_RE.test(form.brand_color) ? form.brand_color : "#6E58F1"}
                    onChange={(e) => setForm({ ...form, brand_color: e.target.value.toUpperCase() })}
                    className="h-7 w-9 cursor-pointer rounded-md border border-border bg-background"
                  />
                  <Input
                    value={form.brand_color}
                    onChange={(e) => setForm({ ...form, brand_color: e.target.value })}
                    placeholder="#6E58F1"
                    aria-label="Código del color"
                    className={`h-7 w-[92px] px-2 font-mono text-[12px] ${form.brand_color && !HEX_RE.test(form.brand_color) ? "border-destructive" : ""}`}
                  />
                </label>
              </div>
              {/* Vista previa de cómo verá su cabecera */}
              <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-2">
                {form.logo_url ? (
                  <img src={form.logo_url} alt="" className="h-6 max-w-[80px] object-contain" />
                ) : (
                  <span className="flex h-6 w-6 items-center justify-center rounded-md" style={{ background: `${HEX_RE.test(form.brand_color) ? form.brand_color : "#6E58F1"}1f`, color: HEX_RE.test(form.brand_color) ? form.brand_color : "#6E58F1" }}>
                    <Building2 className="h-3.5 w-3.5" />
                  </span>
                )}
                <span className="truncate text-[13px] font-semibold text-foreground">{form.company_name.trim() || form.name.trim() || "Tu cliente"}</span>
                <span className="ml-auto h-2 w-10 rounded-full" style={{ background: HEX_RE.test(form.brand_color) ? form.brand_color : "#6E58F1" }} aria-hidden="true" />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="cliente-notas">Notas</Label>
              <Textarea
                id="cliente-notas"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Qué vende, a quién y cualquier cosa que convenga recordar."
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button onClick={submit} disabled={saving || logoBusy || !form.name.trim() || (!!form.brand_color && !HEX_RE.test(form.brand_color.trim()))} className="gap-2">
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
          agencySlug={agency?.slug ?? null}
          agency={agency}
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

/** Icono y texto de cada paso del menú lateral. */
const STEP_META: Record<StepKey, { icon: typeof User; label: string; hint: string }> = {
  datos: { icon: User, label: "Datos", hint: "Quién es" },
  acceso: { icon: KeyRound, label: "Acceso", hint: "Su usuario" },
  logo: { icon: ImagePlus, label: "Logo", hint: "Su imagen" },
  colores: { icon: Palette, label: "Colores", hint: "Su color" },
  permisos: { icon: ShieldCheck, label: "Permisos", hint: "Qué ve" },
  final: { icon: Sparkles, label: "Resumen", hint: "Y el enlace" },
};

/** Un aviso corto, siempre visible, dentro de una fase. */
function PhaseNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-xl border border-[#E8E4F7] bg-[#F8F6FF] px-3 py-2.5 text-[13px] leading-relaxed text-[#4B5576]">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#6E58F1]" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

/** El dibujo "3D" de cada fase: una baldosa con degradado y brillo, ladeada. */
function PhaseArt({ icon: Icon }: { icon: typeof User }) {
  return (
    <div aria-hidden="true" className="relative hidden h-[92px] w-[120px] shrink-0 sm:block">
      <span className="absolute right-3 top-1 h-16 w-16 rounded-full bg-[#B9A8FF]/40 blur-2xl" />
      <span className="absolute left-3 top-6 h-2 w-2 rounded-full bg-[#8B6BFF]/60" />
      <span className="absolute left-8 top-1 h-1.5 w-1.5 rounded-full bg-[#4FC3F7]/70" />
      <span className="absolute bottom-3 left-1 h-1.5 w-1.5 rounded-full bg-[#C084FC]/70" />
      <span className="absolute right-2 top-2 flex h-[76px] w-[76px] rotate-[-8deg] items-center justify-center rounded-[22px] bg-gradient-to-br from-[#8B7BFF] via-[#6E58F1] to-[#4B33D9] shadow-[0_18px_30px_-10px_rgba(91,64,251,.65),inset_0_2px_0_rgba(255,255,255,.35)]">
        <span className="absolute inset-[6px] rounded-[16px] border border-white/25" />
        <Icon className="h-9 w-9 text-white drop-shadow-[0_4px_8px_rgba(30,10,120,.45)]" strokeWidth={1.8} />
      </span>
    </div>
  );
}

/** Tarjeta de contenido: baldosa de icono, título, subtítulo y lo que lleve dentro. */
function SetupCard({ icon: Icon, title, help, art, children }: {
  icon: typeof User; title: string; help?: string; art?: boolean; children?: React.ReactNode;
}) {
  return (
    <section className="rounded-[20px] border border-[#ECE9F6] bg-white p-4 shadow-[0_10px_30px_-22px_rgba(46,30,140,.35)] sm:p-5">
      <div className="flex items-start gap-3.5">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#F1EDFF] to-[#E6EEFF] text-[#6E58F1]">
          <Icon className="h-5 w-5" strokeWidth={1.9} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-[16px] font-semibold tracking-[-0.02em] text-[#0F172B]">{title}</h3>
          {help && <p className="mt-0.5 text-[13px] leading-relaxed text-[#65768D]">{help}</p>}
        </div>
        {art && <PhaseArt icon={Icon} />}
      </div>
      {children && <div className="mt-4 space-y-3.5">{children}</div>}
    </section>
  );
}

/** Botón principal del diseño: degradado violeta con su marca de "hecho". */
function PrimaryAction({ onClick, disabled, busy, children, icon: Icon = Check }: {
  onClick: () => void; disabled?: boolean; busy?: boolean; children: React.ReactNode; icon?: typeof User;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled || busy}
      className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#6E58F1] to-[#8B3CF5] px-5 text-[14px] font-semibold text-white shadow-[0_12px_24px_-10px_rgba(106,76,255,.75)] transition hover:brightness-110 active:scale-[.98] disabled:opacity-60">
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />} {children}
    </button>
  );
}

const fieldClass = "h-11 rounded-xl border-[#E2DEEF] bg-white text-[14.5px] text-[#0F172B] focus-visible:ring-[#6E58F1]/30";
const softBtn = "inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#E2DEEF] bg-white px-3 text-[13px] font-semibold text-[#334063] transition-colors hover:bg-[#F6F4FD] disabled:opacity-50";

/**
 * Configuración por fases de un cliente.
 *
 * No es un formulario largo: son cinco fases que se pueden hacer en cualquier
 * orden, dejar a medias y retomar otro día. El progreso NO se guarda aquí —
 * se lee de `client.setup`, que el servidor deriva de las propias columnas.
 * Diseño (12-11-2026): menú lateral con iconos y tarjetas, siempre en claro.
 */
function ClientSetupDialog({
  client,
  agencySlug,
  agency,
  onClose,
  onChanged,
}: {
  client: ClientRow;
  agencySlug?: string | null;
  agency?: AgencyBranding | null;
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
  // Sin color propio, su panel sale con el de tu agencia: la propuesta parte de ahí.
  const [color, setColor] = useState(client.brand_color || (agency?.brand_color && HEX_RE.test(agency.brand_color) ? agency.brand_color.toUpperCase() : "#6E58F1"));

  // Fase 5 · Permisos
  const [sections, setSections] = useState<string[]>(() => [...(client.allowed_sections || [])]);

  // La entrada EXCLUSIVA de los clientes de esta agencia (con su logo), no el login de Funnyleads.
  const accessLink = agencyLoginUrl(window.location.origin, agencySlug || null);
  const pending = useMemo(() => PHASES.filter((p) => !setup?.[p.key]), [setup]);
  const doneCount = PHASES.length - pending.length;
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
    setUploading(true);
    try {
      const { url, color: hex } = await uploadClientLogo(file);
      setLogoUrl(url);
      // De paso, el color de marca sale del propio logo.
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
  const hex = HEX_RE.test(color) ? color : "#6E58F1";
  const clientColor = HEX_RE.test(client.brand_color || "") ? client.brand_color! : "#6E58F1";
  // Vista previa de la marca doble y de la bienvenida que verá al entrar.
  const agencyPreview = rowToAgency(agency) ?? { name: "Tu agencia", logo: null, color: null };
  const barOf = (h: string) => { const b = brandBarHsl(h); return b ? `hsl(${b.h} ${b.s}% ${b.l}%)` : h; };
  const welcomeHex = agencyPreview.color || hex;

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="force-light flex max-h-[94dvh] w-[calc(100vw-1rem)] max-w-[1000px] flex-col gap-0 overflow-hidden rounded-[26px] border border-white bg-[#F6F5FB] p-0 shadow-[0_40px_90px_-30px_rgba(30,20,90,.5)] sm:w-[calc(100vw-2rem)]">
        {/* Cabecera */}
        <div className="relative shrink-0 overflow-hidden border-b border-[#ECE9F6] bg-white px-5 pb-4 pt-5 sm:px-7">
          <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-28 h-60 w-[420px] rotate-[-12deg] rounded-full bg-gradient-to-r from-transparent via-[#C9B8FF]/50 to-[#7C5CFF]/40 blur-2xl" />
          <div className="relative flex items-center gap-3.5 pr-8">
            {client.logo_url ? (
              <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-[#ECE9F6] bg-white p-1.5 shadow-sm">
                <img src={client.logo_url} alt="" className="max-h-full max-w-full object-contain" />
              </span>
            ) : (
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-[19px] font-bold text-white shadow-[0_10px_22px_-10px_rgba(30,20,90,.55)]" style={{ background: `linear-gradient(135deg, ${clientColor}, ${clientColor}cc)` }}>
                {(client.name || "C").charAt(0).toUpperCase()}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <DialogTitle className="truncate font-display text-[20px] font-semibold tracking-[-0.03em] text-[#0F172B] sm:text-[22px]">
                Configurar «{client.name}»
              </DialogTitle>
              <DialogDescription className="text-[13px] text-[#65768D]">
                Cinco fases en el orden que quieras. Lo que guardas se queda guardado.
              </DialogDescription>
            </div>
            <div className="hidden w-44 shrink-0 sm:block">
              <p className="text-right text-[12px] font-semibold text-[#4B5576]">{doneCount} de {PHASES.length} fases</p>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[#EEEBF7]">
                <span className="block h-full rounded-full bg-gradient-to-r from-[#6E58F1] to-[#A855F7] transition-all duration-500" style={{ width: `${(doneCount / PHASES.length) * 100}%` }} />
              </div>
            </div>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-rows-[auto_1fr] md:grid-cols-[230px_minmax(0,1fr)] md:grid-rows-1">
          {/* Menú de fases: lateral en ordenador, fila deslizable en móvil */}
          <nav aria-label="Fases de configuración" className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-[#ECE9F6] bg-white/60 px-3 py-2.5 md:flex-col md:gap-1 md:overflow-visible md:border-b-0 md:border-r md:px-3 md:py-4">
            {STEP_ORDER.map((key) => {
              const meta = STEP_META[key];
              const Icon = meta.icon;
              const active = step === key;
              const done = key !== "final" && !!setup?.[key as PhaseKey];
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setStep(key)}
                  aria-current={active ? "step" : undefined}
                  className={cn(
                    "group relative flex shrink-0 items-center gap-2.5 rounded-2xl px-3 py-2 text-left transition-all md:w-full md:py-2.5",
                    active
                      ? "bg-gradient-to-r from-[#6E58F1] to-[#8B3CF5] text-white shadow-[0_12px_24px_-12px_rgba(106,76,255,.85)]"
                      : "text-[#334063] hover:bg-white hover:shadow-[0_6px_16px_-12px_rgba(46,30,140,.4)]",
                  )}
                >
                  <span className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-colors",
                    active ? "bg-white/20 text-white" : "bg-[#F1EEFB] text-[#6E58F1]",
                  )}>
                    <Icon className="h-4 w-4" strokeWidth={2} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13.5px] font-semibold leading-tight">{meta.label}</span>
                    <span className={cn("hidden text-[11.5px] leading-tight md:block", active ? "text-white/75" : "text-[#8A93AD]")}>{meta.hint}</span>
                  </span>
                  {key !== "final" && (
                    <span className={cn(
                      "ml-auto hidden h-5 w-5 shrink-0 items-center justify-center rounded-full md:flex",
                      done ? (active ? "bg-white text-[#6E58F1]" : "bg-[#16A34A] text-white") : (active ? "border-2 border-white/60" : "border-2 border-[#DCD6F2]"),
                    )}>
                      {done && <Check className="h-3 w-3" strokeWidth={3} />}
                    </span>
                  )}
                  {key !== "final" && done && (
                    <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-[#16A34A] text-white ring-2 ring-white md:hidden">
                      <Check className="h-2.5 w-2.5" strokeWidth={3} />
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Contenido de la fase */}
          <div className="min-h-0 space-y-4 overflow-y-auto px-4 py-5 sm:px-6">
            {step === "datos" && (
              <>
                <SetupCard icon={User} title="Datos del cliente" help="Quién es el cliente. Solo el nombre es obligatorio." art>
                  <div className="grid gap-3.5 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="fase1-nombre" className="text-[13px] text-[#334063]">Nombre</Label>
                      <Input
                        id="fase1-nombre"
                        className={fieldClass}
                        value={datos.name}
                        aria-invalid={!!datosError}
                        onChange={(e) => { setDatos({ ...datos, name: e.target.value }); setDatosError(null); }}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="fase1-empresa" className="text-[13px] text-[#334063]">Empresa</Label>
                      <Input
                        id="fase1-empresa"
                        className={fieldClass}
                        value={datos.company_name}
                        onChange={(e) => setDatos({ ...datos, company_name: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="fase1-email" className="text-[13px] text-[#334063]">Email de contacto</Label>
                    <Input
                      id="fase1-email"
                      type="email"
                      className={fieldClass}
                      value={datos.contact_email}
                      onChange={(e) => setDatos({ ...datos, contact_email: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="fase1-notas" className="text-[13px] text-[#334063]">Notas</Label>
                    <Textarea
                      id="fase1-notas"
                      rows={3}
                      className="rounded-xl border-[#E2DEEF] bg-white text-[14.5px]"
                      value={datos.notes}
                      onChange={(e) => setDatos({ ...datos, notes: e.target.value })}
                    />
                  </div>
                  {datosError && <p className="text-[13px] font-semibold text-destructive">{datosError}</p>}
                  <PrimaryAction onClick={saveDatos} busy={spin("datos")}>Guardar datos</PrimaryAction>
                </SetupCard>
              </>
            )}

            {step === "acceso" && (
              <>
                <SetupCard
                  icon={KeyRound}
                  title="Su acceso"
                  help="El usuario con el que tu cliente entra por TU enlace de clientes. Trabaja en su propio panel, con sus datos, y solo ve las secciones que le abras en Permisos."
                  art
                >
                  {client.login_email ? (
                    <>
                      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#D9F2E3] bg-[#F2FBF5] p-3.5">
                        <div className="min-w-0">
                          <p className="text-[12.5px] font-medium text-[#3F7A57]">Ya puede entrar con</p>
                          <p className="mt-0.5 break-all font-mono text-[15px] font-semibold text-[#0F172B]">{client.login_email}</p>
                        </div>
                        <button type="button" className={softBtn} onClick={() => copyToClipboard(client.login_email || "", "Email")}>
                          <Copy className="h-3.5 w-3.5" /> Copiar email
                        </button>
                      </div>
                      {lastPassword && (
                        <div className="rounded-2xl border border-[#D9D2FB] bg-[#F5F2FF] p-3.5">
                          <p className="text-[13px] font-semibold text-[#2E2560]">
                            Esta es la contraseña que acabas de poner. Cópiala ahora: no la guardamos.
                          </p>
                          <p className="mt-1.5 flex flex-wrap items-center gap-2 break-all font-mono text-[15px] text-[#0F172B]">
                            {lastPassword}
                            <button type="button" className={softBtn} onClick={() => copyToClipboard(lastPassword, "Contraseña")}>
                              <Copy className="h-3.5 w-3.5" /> Copiar
                            </button>
                          </p>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="space-y-1.5">
                      <Label htmlFor="fase2-email" className="text-[13px] text-[#334063]">Email de acceso</Label>
                      <Input
                        id="fase2-email"
                        type="email"
                        className={fieldClass}
                        value={loginEmail}
                        onChange={(e) => { setLoginEmail(e.target.value); setAccesoError(null); }}
                        placeholder="ana@verasalud.com"
                      />
                    </div>
                  )}
                </SetupCard>

                <SetupCard
                  icon={RefreshCw}
                  title={client.login_email ? "Cambiar contraseña" : "Contraseña"}
                  help="No la guardamos en ningún sitio: cópiala y mándasela. Si la pierde, le pones una nueva desde aquí."
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      id={client.login_email ? "fase2-nueva" : "fase2-pass"}
                      aria-label={client.login_email ? "Cambiar contraseña" : "Contraseña"}
                      className={cn(fieldClass, "w-full max-w-[260px] font-mono")}
                      value={password}
                      onChange={(e) => { setPassword(e.target.value); setAccesoError(null); }}
                    />
                    <button type="button" className={softBtn} onClick={() => setPassword(generatePassword())}>
                      <RefreshCw className="h-3.5 w-3.5" /> Generar otra
                    </button>
                    <button type="button" className={softBtn} onClick={() => copyToClipboard(password, "Contraseña")}>
                      <Copy className="h-3.5 w-3.5" /> Copiar
                    </button>
                  </div>
                  {accesoError && <p className="text-[13px] font-semibold text-destructive">{accesoError}</p>}
                  <div className="flex flex-wrap items-center gap-2">
                    {client.login_email ? (
                      <>
                        <PrimaryAction onClick={resetPassword} disabled={password.length < 8} busy={spin("password")}>Cambiar contraseña</PrimaryAction>
                        <button type="button" className={cn(softBtn, "h-11 text-destructive hover:bg-destructive/5")} onClick={removeAccess} disabled={spin("quitar")}>
                          {spin("quitar") ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />} Quitar acceso
                        </button>
                      </>
                    ) : (
                      <PrimaryAction onClick={createAccess} busy={spin("acceso")} icon={KeyRound}>Crear acceso</PrimaryAction>
                    )}
                  </div>
                </SetupCard>
              </>
            )}

            {step === "logo" && (
              <SetupCard icon={ImagePlus} title="Su logo" help="Lo verá arriba del todo en su panel al entrar, en lugar del de Funnyleads." art>
                <div className="flex flex-wrap items-center gap-4">
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    disabled={uploading}
                    className="group flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-[#DCD6F2] bg-[#FBFAFF] transition-colors hover:border-[#6E58F1]"
                    aria-label={logoUrl ? "Cambiar el logo" : "Subir el logo"}
                  >
                    {uploading ? <Loader2 className="h-6 w-6 animate-spin text-[#6E58F1]" />
                      : logoUrl ? <img src={logoUrl} alt="Logo del cliente" className="h-full w-full object-contain p-2" />
                      : <ImageIcon className="h-7 w-7 text-[#9A93BD] group-hover:text-[#6E58F1]" />}
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    aria-label="Archivo de logo"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadLogo(f); }}
                  />
                  <div className="min-w-[220px] flex-1 space-y-2">
                    <button type="button" className={softBtn} disabled={uploading} onClick={() => fileRef.current?.click()}>
                      {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Subir archivo
                    </button>
                    <div className="space-y-1.5">
                      <Label htmlFor="fase3-url" className="text-[13px] text-[#334063]">…o pega la dirección de una imagen</Label>
                      <Input id="fase3-url" className={fieldClass} value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://…/logo.png" />
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <PrimaryAction onClick={saveLogo} disabled={uploading} busy={spin("logo")}>Guardar logo</PrimaryAction>
                  {logoUrl && (
                    <button type="button" className={cn(softBtn, "h-11")} onClick={() => setLogoUrl("")} disabled={spin("logo")}>Quitar</button>
                  )}
                </div>
              </SetupCard>
            )}

            {step === "colores" && (
              <>
                <SetupCard icon={Palette} title="Su color" help="El color con el que se le pinta la plataforma: botones, menú y detalles. Así la ve él." art>
                  <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Color de marca del cliente">
                    {BRAND_SWATCHES.map((c) => {
                      const on = color.toUpperCase() === c;
                      return (
                        <button key={c} type="button" role="radio" aria-checked={on} aria-label={`Color ${c}`} onClick={() => setColor(c)}
                          className={cn("h-8 w-8 rounded-full border border-black/10 transition-transform hover:scale-110", on && "ring-2 ring-white")}
                          style={{ background: c, ...(on ? { boxShadow: `0 0 0 4px ${c}55` } : {}) }} />
                      );
                    })}
                  </div>
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="fase4-color" className="text-[13px] text-[#334063]">Color de marca</Label>
                      <div className="flex items-center gap-2">
                        <input
                          id="fase4-color"
                          type="color"
                          value={hex}
                          onChange={(e) => setColor(e.target.value.toUpperCase())}
                          className="h-11 w-14 cursor-pointer rounded-xl border border-[#E2DEEF] bg-white"
                        />
                        <Input value={color} onChange={(e) => setColor(e.target.value)} className={cn(fieldClass, "w-32 font-mono")} aria-label="Código del color de marca" />
                      </div>
                    </div>
                    <button type="button" className={cn(softBtn, "h-11")} disabled={!(logoUrl.trim() || client.logo_url) || spin("color-logo")} onClick={colorFromLogo}>
                      {spin("color-logo") ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Palette className="h-3.5 w-3.5" />} Sacar del logo
                    </button>
                  </div>
                  <PrimaryAction onClick={saveColor} busy={spin("colores")} disabled={!HEX_RE.test(color)}>Guardar color</PrimaryAction>
                </SetupCard>

                {/* Vista previa de su panel, con su color */}
                <SetupCard icon={Eye} title="Vista previa" help="Así se verá su panel: tu logo y el suyo arriba, y todo con su color.">
                  <div className="overflow-hidden rounded-2xl border border-[#ECE9F6] shadow-[0_10px_24px_-18px_rgba(30,20,90,.5)]">
                    <div className="flex items-center gap-2 px-3 py-2.5" style={{ background: barOf(hex) }}>
                      <CoBrand
                        size="mini"
                        agency={agencyPreview}
                        client={{ name: client.company_name || client.name || "Cliente", logo: logoUrl || null, color: hex }}
                      />
                      <span className="ml-1 truncate text-[13px] font-semibold text-white">{client.company_name || client.name}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 bg-[#FBFAFE] p-3">
                      <span className="rounded-lg border border-[#ECE9F6] bg-white px-2.5 py-1 text-[12px] font-semibold text-[#65768D]">
                        Enviados <span className="tabular-nums text-[#0F172B]">1.240</span>
                      </span>
                      <span className="rounded-lg border px-2.5 py-1 text-[12px] font-semibold" style={{ borderColor: `${hex}55`, background: `${hex}14`, color: hex }}>
                        Respuestas <span className="tabular-nums">37</span>
                      </span>
                      <span className="ml-auto inline-flex rounded-lg px-3 py-1.5 text-[12.5px] font-semibold text-white" style={{ background: hex }}>
                        Así se ven sus botones
                      </span>
                    </div>
                  </div>
                </SetupCard>

                {/* La bienvenida que verá la primera vez que entre */}
                <SetupCard icon={Sparkles} title="Su bienvenida" help="La primera vez que entre verá esto, con el logo y los colores de tu agencia, y un mini tutorial de su panel.">
                  <div className="overflow-hidden rounded-2xl border border-[#ECE9F6] bg-white shadow-[0_10px_24px_-18px_rgba(30,20,90,.5)]">
                    <div className="relative overflow-hidden px-4 pb-4 pt-5 text-center text-white" style={{ background: `linear-gradient(140deg, ${barOf(welcomeHex)} 0%, ${welcomeHex} 100%)` }}>
                      <span aria-hidden="true" className="pointer-events-none absolute -right-10 -top-12 h-32 w-32 rounded-full bg-white/10 blur-xl" />
                      <div className="relative flex justify-center">
                        <CoBrand size="mini" agency={agencyPreview} client={{ name: client.company_name || client.name || "Cliente", logo: logoUrl || null, color: hex }} />
                      </div>
                      <p className="relative mt-3 font-display text-[18px] font-semibold tracking-[-0.02em]">Bienvenido a {agencyPreview.name}</p>
                      <p className="relative mt-1 text-[12px] text-white/85">Hemos preparado este panel para {client.company_name || client.name}.</p>
                    </div>
                    <div className="flex items-center justify-between gap-2 px-4 py-2.5">
                      <span className="flex items-center gap-1">
                        {[0, 1, 2].map((i) => <span key={i} className="h-1.5 rounded-full" style={{ width: i === 0 ? 16 : 6, background: i === 0 ? welcomeHex : "#E4E2F0" }} />)}
                      </span>
                      <span className="rounded-lg px-3 py-1 text-[12px] font-semibold text-white" style={{ background: welcomeHex }}>Ver mi panel →</span>
                    </div>
                  </div>
                  {!agency?.agency_name && (
                    <p className="mt-2 text-[12.5px] text-[#65768D]">Pon el nombre y el logo de tu agencia en «Tu marca de agencia» (arriba en Clientes) para que salgan aquí.</p>
                  )}
                </SetupCard>
              </>
            )}

            {step === "permisos" && (
              <SetupCard
                icon={ShieldCheck}
                title="Qué puede usar"
                help="Las secciones de su panel. Trabaja en ellas con sus propios datos; lo que envíe cuenta en tu plan. Para lanzar campañas necesita Cuentas de email y Leads."
                art
              >
                <div className="grid gap-2.5 sm:grid-cols-2">
                  {CLIENT_SECTIONS.map((s) => {
                    const on = sections.includes(s.key);
                    return (
                      <label
                        key={s.key}
                        htmlFor={`fase5-${s.key}`}
                        className={cn(
                          "relative flex cursor-pointer items-start gap-3 rounded-2xl border bg-white p-3.5 pr-10 transition-all",
                          on ? "border-[#7C5CFF] shadow-[0_0_0_3px_rgba(124,92,255,.14),0_12px_24px_-16px_rgba(106,76,255,.7)]" : "border-[#ECE9F6] hover:border-[#D9D2FB]",
                        )}
                      >
                        <Checkbox id={`fase5-${s.key}`} className="sr-only" checked={on} onCheckedChange={() => toggleSection(s.key)} />
                        <span aria-hidden="true" className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", on ? "bg-gradient-to-br from-[#7C5CFF] to-[#5B40FB] text-white" : "bg-[#F1EEFB] text-[#6E58F1]")}>
                          <s.icon className="h-[18px] w-[18px]" strokeWidth={1.9} />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-[14.5px] font-semibold text-[#0F172B]">{s.label}</span>
                          <span className="block text-[12.5px] leading-snug text-[#65768D]">{s.help}</span>
                        </span>
                        <span aria-hidden="true" className={cn("absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full", on ? "bg-[#6E58F1] text-white" : "border-2 border-[#DCD6F2]")}>
                          {on && <Check className="h-3 w-3" strokeWidth={3} />}
                        </span>
                      </label>
                    );
                  })}
                </div>
                {sections.length === 0 && (
                  <PhaseNote>Sin ninguna marcada, el cliente entra y no ve nada. Marca al menos una.</PhaseNote>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <PrimaryAction onClick={savePermisos} busy={spin("permisos")}>Guardar permisos</PrimaryAction>
                  <button type="button" className={cn(softBtn, "h-11")} onClick={() => setSections(CLIENT_SECTIONS.map((s) => s.key))}>Marcar todas</button>
                </div>
              </SetupCard>
            )}

            {step === "final" && (
              <>
                <SetupCard
                  icon={Sparkles}
                  title={pending.length === 0 ? `Todo listo: ${client.name} ya está conectado` : `Todavía ${pending.length === 1 ? "falta una fase" : `faltan ${pending.length} fases`}`}
                  help={pending.length === 0
                    ? `Entra con ${client.login_email || "su email"} y ve ${(client.allowed_sections || []).length} sección${(client.allowed_sections || []).length === 1 ? "" : "es"} de su panel.`
                    : "Puedes dejarlo aquí y seguir otro día: lo guardado no se pierde."}
                  art
                >
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {PHASES.map((p) => {
                      const done = !!setup?.[p.key];
                      const Icon = STEP_META[p.key].icon;
                      return (
                        <li key={p.key}>
                          <button type="button" onClick={() => setStep(p.key)}
                            className="flex w-full items-center gap-2.5 rounded-xl border border-[#ECE9F6] bg-[#FBFAFE] px-3 py-2 text-left transition-colors hover:bg-white">
                            <Icon className="h-4 w-4 text-[#6E58F1]" />
                            <span className="text-[13.5px] font-semibold text-[#0F172B]">Fase {p.n} · {p.label}</span>
                            <span className={cn("ml-auto flex h-5 w-5 items-center justify-center rounded-full", done ? "bg-[#16A34A] text-white" : "border-2 border-[#DCD6F2]")}>
                              {done && <Check className="h-3 w-3" strokeWidth={3} />}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </SetupCard>

                <SetupCard icon={Link2} title="Enlace de acceso del cliente" help="Su entrada exclusiva: sale el logo de tu agencia y, al entrar, su propio panel con su logo. No es el inicio de sesión de Funnyleads.">
                  <div className="flex flex-wrap items-center gap-2">
                    <Input id="fase-final-enlace" aria-label="Enlace de acceso del cliente" readOnly value={accessLink} className={cn(fieldClass, "min-w-0 flex-1 font-mono text-[13px]")} />
                    <PrimaryAction onClick={() => copyToClipboard(accessLink, "Enlace")} icon={Copy}>Copiar enlace</PrimaryAction>
                    <a href={accessLink} target="_blank" rel="noreferrer" className={cn(softBtn, "h-11")}>
                      Abrir <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </div>
                  {!agencySlug && (
                    <PhaseNote>Pon tu logo y el nombre de tu agencia en «Tu marca de agencia», arriba en Clientes: es lo que verá en esa entrada.</PhaseNote>
                  )}
                  <PhaseNote>
                    Entra con su email y su contraseña y trabaja en su panel: crea campañas, ve sus respuestas en el Unibox,
                    sus estadísticas y la IA. Todo lo que envíe cuenta en tu plan.
                  </PhaseNote>
                </SetupCard>

                {!setup?.campanas && (
                  <PhaseNote>
                    También puedes llevarle tú campañas: asígnaselas desde las opciones de cada campaña y las verás por cliente aquí.
                  </PhaseNote>
                )}
              </>
            )}
          </div>
        </div>

        {/* Pie */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-[#ECE9F6] bg-white px-5 py-3 sm:px-7">
          <p className="hidden text-[12.5px] text-[#8A93AD] sm:block">Los cambios se guardan con el botón de cada fase.</p>
          <div className="ml-auto flex items-center gap-2">
            {step !== "final" && (
              <button type="button" className={softBtn} onClick={goNext}>Siguiente fase</button>
            )}
            <button type="button" onClick={onClose} disabled={!!busy}
              className="inline-flex h-9 items-center rounded-xl bg-[#0F172B] px-4 text-[13px] font-semibold text-white transition hover:bg-[#1E2745] disabled:opacity-60">
              Cerrar
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
