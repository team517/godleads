// Área del cliente — lo único que ve la cuenta de acceso de un cliente.
//
// Es de SOLO LECTURA por diseño: aquí no hay un solo botón que cree, cambie o
// borre nada. Lo que puede mirar tampoco se decide aquí: `my_client_context()`
// devuelve la lista de secciones que el dueño le ha dado (y no devuelve NADA si
// quien llama no es la cuenta de acceso de un cliente), y `client_campaign_stats`
// sólo responde al dueño o a esa misma cuenta. Esta pantalla se limita a pintar
// lo que el servidor entrega.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { brandStyleFor } from "@/lib/brandColor";
import {
  Building2,
  FileBarChart,
  KeyRound,
  LogOut,
  Mail,
  MailWarning,
  Megaphone,
  MessageSquareReply,
  Send,
  Users,
} from "lucide-react";

/** Las únicas secciones que existen. Lo que venga fuera de esta lista se ignora:
 *  la lista blanca del servidor es la misma, esta es la segunda red. */
const AREA_SECTIONS = ["resumen", "campanas", "respuestas", "informes"] as const;
type AreaSection = (typeof AREA_SECTIONS)[number];

export type ClientContext = {
  client_id: string;
  owner_user_id: string;
  name: string;
  company_name: string | null;
  logo_url: string | null;
  brand_color: string | null;
  sections: string[] | null;
};

export type CampaignStat = {
  campaign_id: string;
  name: string;
  status: string;
  created_at: string;
  leads: number;
  sent: number;
  replied: number;
  bounced: number;
};

const STATUS_LABEL: Record<string, string> = {
  active: "Activa",
  running: "Activa",
  paused: "En pausa",
  draft: "Borrador",
  completed: "Terminada",
  stopped: "Parada",
};

function Metric({ icon, value, label }: { icon: React.ReactNode; value: number; label: string }) {
  return (
    <div className="rounded-md border border-border bg-card p-4 shadow-rest">
      <span className="flex items-center gap-1.5 text-[13px] font-semibold text-muted-foreground">
        {icon} {label}
      </span>
      <p className="mt-1 font-display text-[24px] font-semibold tabular-nums tracking-[-0.03em] text-foreground">
        {value.toLocaleString("es")}
      </p>
    </div>
  );
}

/** Un panel honesto: aún no hay de dónde sacar estos datos, así que se dice. */
function NadaTodavia({ title, help }: { title: string; help: string }) {
  return (
    <div className="rounded-md border border-dashed border-border bg-muted/30 p-6 text-center">
      <p className="font-display text-[15px] font-semibold tracking-[-0.02em] text-foreground">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-[13px] text-muted-foreground">{help}</p>
    </div>
  );
}

function SectionTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <h2 className="flex items-center gap-2 font-display text-[17px] font-semibold tracking-[-0.03em] text-foreground">
      {icon} {children}
    </h2>
  );
}

/** Las funciones nuevas todavía no están en los tipos generados de Supabase, así
 *  que se llaman por esta vista mínima en vez de con `any`. */
type RpcCaller = {
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }>;
};
const rpcClient = supabase as unknown as RpcCaller;

const num = (v: unknown) => Number(v ?? 0) || 0;
const str = (v: unknown) => String(v ?? "");

export default function AreaCliente() {
  const { signOut } = useAuth();
  const [ctx, setCtx] = useState<ClientContext | null>(null);
  const [stats, setStats] = useState<CampaignStat[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "not_client" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    setError(null);
    const { data, error: rpcErr } = await rpcClient.rpc("my_client_context");
    if (rpcErr) {
      setError(rpcErr.message || "No pudimos cargar tu área.");
      setState("error");
      return;
    }
    const row = (Array.isArray(data) ? data[0] : data) as ClientContext | undefined;
    if (!row?.client_id) {
      // Esta cuenta no es el acceso de ningún cliente: no es su sitio.
      setState("not_client");
      return;
    }
    setCtx(row);
    const { data: rows, error: statsErr } = await rpcClient.rpc("client_campaign_stats", {
      p_client_id: row.client_id,
    });
    if (statsErr) {
      setError(statsErr.message || "No pudimos cargar tus campañas.");
      setState("error");
      return;
    }
    const list = Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
    setStats(
      list.map((r) => ({
        campaign_id: str(r.campaign_id),
        name: str(r.name),
        status: str(r.status),
        created_at: str(r.created_at),
        leads: num(r.leads),
        sent: num(r.sent),
        replied: num(r.replied),
        bounced: num(r.bounced),
      })),
    );
    setState("ready");
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const sections = useMemo<AreaSection[]>(() => {
    const raw = ctx?.sections || [];
    return AREA_SECTIONS.filter((s) => raw.includes(s));
  }, [ctx]);

  const totals = useMemo(
    () =>
      stats.reduce(
        (a, c) => ({
          leads: a.leads + c.leads,
          sent: a.sent + c.sent,
          replied: a.replied + c.replied,
          bounced: a.bounced + c.bounced,
        }),
        { leads: 0, sent: 0, replied: 0, bounced: 0 },
      ),
    [stats],
  );

  if (state === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (state === "not_client") return <Navigate to="/dashboard" replace />;

  if (state === "error") {
    return (
      <div className="mx-auto max-w-lg p-6">
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4">
          <p className="font-display text-[15px] font-semibold tracking-[-0.02em] text-destructive">
            No pudimos cargar tu área
          </p>
          <p className="mt-1 text-[13px] text-muted-foreground">{error}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={load}>
            Reintentar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background" style={brandStyleFor(ctx?.brand_color)}>
      {/* Cabecera con la marca del cliente */}
      <header className="sticky top-0 z-10 border-b border-border bg-card/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            {ctx?.logo_url ? (
              <img src={ctx.logo_url} alt={ctx?.name || "logo"} className="h-9 max-w-[140px] rounded-md object-contain" />
            ) : (
              <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Building2 className="h-4 w-4" />
              </span>
            )}
            <div className="min-w-0">
              <p className="truncate font-display text-[15px] font-semibold tracking-[-0.02em] text-foreground">
                {ctx?.company_name || ctx?.name}
              </p>
              <p className="truncate text-[12px] text-muted-foreground">Tus campañas, en directo</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button asChild variant="ghost" size="sm" className="gap-1.5 text-[13px]">
              <Link to="/settings">
                <KeyRound className="h-3.5 w-3.5" /> Mi contraseña
              </Link>
            </Button>
            <Button variant="ghost" size="sm" className="gap-1.5 text-[13px]" onClick={() => signOut()}>
              <LogOut className="h-3.5 w-3.5" /> Salir
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-8 px-4 py-6">
        {sections.length === 0 && (
          <NadaTodavia
            title="Tu área está casi lista"
            help="Todavía no se ha abierto ninguna sección para ti. En cuanto tu agencia la active, aparecerá aquí."
          />
        )}

        {/* ── Resumen ─────────────────────────────────────────────────────── */}
        {sections.includes("resumen") && (
          <section className="space-y-3">
            <SectionTitle icon={<FileBarChart className="h-4 w-4 text-primary" />}>Resumen</SectionTitle>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Metric icon={<Users className="h-3.5 w-3.5" />} value={totals.leads} label="Leads" />
              <Metric icon={<Send className="h-3.5 w-3.5" />} value={totals.sent} label="Enviados" />
              <Metric icon={<MessageSquareReply className="h-3.5 w-3.5" />} value={totals.replied} label="Respuestas" />
              <Metric icon={<MailWarning className="h-3.5 w-3.5" />} value={totals.bounced} label="Rebotes" />
            </div>
            <p className="text-[13px] text-muted-foreground">
              {stats.length === 0
                ? "Todavía no hay campañas en marcha, así que no hay números que contar."
                : `Suma de tus ${stats.length} campaña${stats.length === 1 ? "" : "s"}.`}
            </p>
          </section>
        )}

        {/* ── Campañas ────────────────────────────────────────────────────── */}
        {sections.includes("campanas") && (
          <section className="space-y-3">
            <SectionTitle icon={<Megaphone className="h-4 w-4 text-primary" />}>Campañas</SectionTitle>
            {stats.length === 0 ? (
              <NadaTodavia
                title="Todavía no hay nada que mostrar aquí"
                help="Cuando tu agencia ponga en marcha una campaña para ti, la verás en esta lista con sus cifras."
              />
            ) : (
              <div className="overflow-x-auto rounded-md border border-border bg-card shadow-rest">
                <table className="w-full min-w-[640px] border-collapse text-[15px]">
                  <thead>
                    <tr className="border-b border-border bg-muted/50 text-[13px] font-semibold text-muted-foreground">
                      <th scope="col" className="px-4 py-2.5 text-left">Nombre</th>
                      <th scope="col" className="px-4 py-2.5 text-left">Estado</th>
                      <th scope="col" className="px-4 py-2.5 text-right">Leads</th>
                      <th scope="col" className="px-4 py-2.5 text-right">Enviados</th>
                      <th scope="col" className="px-4 py-2.5 text-right">Respuestas</th>
                      <th scope="col" className="px-4 py-2.5 text-right">Rebotes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.map((c) => (
                      <tr key={c.campaign_id} className="border-b border-border/60 last:border-b-0">
                        <td className="px-4 py-3 font-semibold text-foreground">{c.name}</td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center rounded-md border border-border bg-muted/40 px-2 py-0.5 text-[12px] font-semibold text-muted-foreground">
                            {STATUS_LABEL[c.status] || c.status || "—"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">{c.leads.toLocaleString("es")}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{c.sent.toLocaleString("es")}</td>
                        <td className="px-4 py-3 text-right tabular-nums font-semibold text-primary">
                          {c.replied.toLocaleString("es")}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">{c.bounced.toLocaleString("es")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* ── Respuestas ──────────────────────────────────────────────────── */}
        {/* Todavía no hay una fuente de datos para esto: se dice tal cual en vez
            de pintar un buzón vacío que parezca real. */}
        {sections.includes("respuestas") && (
          <section className="space-y-3">
            <SectionTitle icon={<Mail className="h-4 w-4 text-primary" />}>Respuestas</SectionTitle>
            <NadaTodavia
              title="Todavía no hay nada que mostrar aquí"
              help="Estamos preparando esta sección para que veas las respuestas de tus leads. Mientras, tu agencia te las pasa como siempre."
            />
          </section>
        )}

        {/* ── Informes ────────────────────────────────────────────────────── */}
        {sections.includes("informes") && (
          <section className="space-y-3">
            <SectionTitle icon={<FileBarChart className="h-4 w-4 text-primary" />}>Informes</SectionTitle>
            <NadaTodavia
              title="Todavía no hay nada que mostrar aquí"
              help="Aquí aparecerán los informes de tus campañas cuando estén disponibles."
            />
          </section>
        )}

        <Card className="border-dashed">
          <CardContent className="p-4">
            <p className="text-[13px] text-muted-foreground">
              Esta área es solo de consulta: puedes mirar tus resultados, pero nada de lo que ves se puede cambiar desde
              aquí. Si algo no cuadra, dilo a tu agencia.
            </p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
