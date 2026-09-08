import { useState, useEffect, useMemo } from "react";
import { Navigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { ADMIN_EMAILS } from "@/lib/access";
import { ChevronLeft, ChevronDown, ChevronRight, Loader2, Send, Check, FileText, Users } from "lucide-react";

// ── Copy: agency-only section (hello@ / support@ / equipo@) ─────────────────────
// Lists every client; opening one shows their campaigns' full copy (steps + variants)
// with checkboxes, and "Enviar copy" emails it to the client from support@onepulso.online
// (admin-users action send_copy builds the branded HTML server-side).

interface ClientRow { id: string; email: string; company_name?: string | null; full_name?: string | null; logo_url?: string | null; brand_color?: string | null; }
interface StepRow { step_order: number; subject: string | null; body: string | null; variants: unknown[] | null; delay_days: number | null; }
interface CampaignCopy { id: string; name: string; status: string; steps: StepRow[]; }

async function callAdmin(payload: Record<string, unknown>) {
  const { data: { session } } = await supabase.auth.getSession();
  const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-users`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
    body: JSON.stringify(payload),
  });
  return resp.json();
}

/** Render body text with {{variables}} highlighted as purple chips. */
function CopyText({ text }: { text: string }) {
  const parts = useMemo(() => (text || "").split(/(\{\{[^}]+\}\})/g), [text]);
  return (
    <span className="whitespace-pre-wrap">
      {parts.map((p, i) =>
        /^\{\{[^}]+\}\}$/.test(p)
          ? <span key={i} className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[12px] font-semibold text-primary whitespace-nowrap">{p}</span>
          : <span key={i}>{p}</span>
      )}
    </span>
  );
}

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  active: { label: "Active", cls: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30" },
  paused: { label: "Paused", cls: "bg-amber-500/10 text-amber-600 border-amber-500/30" },
  draft: { label: "Draft", cls: "bg-muted text-muted-foreground border-border" },
};

export default function CopyClientes() {
  const { user, loading: authLoading } = useAuth();
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ClientRow | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignCopy[] | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [toEmail, setToEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sentOk, setSentOk] = useState(false);

  useEffect(() => {
    if (!user) return;
    callAdmin({ action: "list_clients" }).then((r) => {
      setClients((r.clients || []).sort((a: ClientRow, b: ClientRow) => (a.company_name || a.email).localeCompare(b.company_name || b.email)));
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [user]);

  const openClient = async (c: ClientRow) => {
    setSelected(c);
    setCampaigns(null);
    setSentOk(false);
    setToEmail(c.email);
    const r = await callAdmin({ action: "client_campaign_copy", user_id: c.id });
    const camps: CampaignCopy[] = (r.campaigns || []).filter((x: CampaignCopy) => (x.steps || []).length > 0);
    setCampaigns(camps);
    // Preselect the ACTIVE campaigns (what the client is actually running); expand the first one.
    const act = camps.filter((x) => x.status === "active").map((x) => x.id);
    setChecked(new Set(act.length ? act : camps.slice(0, 1).map((x) => x.id)));
    setExpanded(new Set(camps.slice(0, 1).map((x) => x.id)));
  };

  const toggle = (set: Set<string>, id: string, setter: (s: Set<string>) => void) => {
    const n = new Set(set);
    if (n.has(id)) n.delete(id); else n.add(id);
    setter(n);
  };

  const sendCopy = async () => {
    if (!selected || checked.size === 0) { toast.info("Selecciona al menos una campaña"); return; }
    setSending(true);
    const r = await callAdmin({ action: "send_copy", user_id: selected.id, campaign_ids: [...checked], to_email: toEmail.trim() });
    setSending(false);
    if (r?.ok) {
      setSentOk(true);
      toast.success(`Copy enviado a ${r.sent_to} (${r.campaigns} campaña${r.campaigns === 1 ? "" : "s"})`);
    } else {
      toast.error(`No se pudo enviar: ${r?.error || "error desconocido"}`);
    }
  };

  if (authLoading) return null;
  if (!user || !ADMIN_EMAILS.includes((user.email || "").toLowerCase())) return <Navigate to="/dashboard" replace />;

  // ── Client detail: campaigns + copy + send bar ──
  if (selected) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 pb-28">
        <button onClick={() => setSelected(null)} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition">
          <ChevronLeft className="h-4 w-4" /> Clientes
        </button>
        <div className="flex items-center gap-3">
          {selected.logo_url
            ? <img src={selected.logo_url} alt="" className="h-11 w-11 rounded-xl object-cover ring-1 ring-border" />
            : <span className="flex h-11 w-11 items-center justify-center rounded-xl text-base font-bold text-white" style={{ backgroundColor: selected.brand_color || "#7A5AF8" }}>
                {(selected.company_name || selected.email).charAt(0).toUpperCase()}
              </span>}
          <div className="min-w-0">
            <h1 className="font-display text-xl font-semibold truncate">{selected.company_name || selected.full_name || selected.email}</h1>
            <p className="text-xs text-muted-foreground truncate">{selected.email}</p>
          </div>
        </div>

        {campaigns === null ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Cargando copy…</div>
        ) : campaigns.length === 0 ? (
          <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">Este cliente aún no tiene campañas con copy.</CardContent></Card>
        ) : (
          <div className="space-y-3">
            {campaigns.map((c) => {
              const st = STATUS_BADGE[c.status] || STATUS_BADGE.draft;
              const isOpen = expanded.has(c.id);
              return (
                <Card key={c.id} className={checked.has(c.id) ? "border-primary/40 shadow-sm" : ""}>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                      <Checkbox checked={checked.has(c.id)} onCheckedChange={() => toggle(checked, c.id, setChecked)} />
                      <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => toggle(expanded, c.id, setExpanded)}>
                        <span className="min-w-0 truncate font-medium">{c.name}</span>
                        <Badge variant="outline" className={`text-[10px] shrink-0 ${st.cls}`}>{st.label}</Badge>
                        <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                          {c.steps.length} paso{c.steps.length === 1 ? "" : "s"}
                          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </span>
                      </button>
                    </div>
                    {isOpen && (
                      <div className="mt-3 space-y-2.5 border-t border-border/60 pt-3">
                        {c.steps.map((s) => (
                          <div key={s.step_order} className="rounded-xl border border-border/60 bg-muted/20 p-3.5">
                            <p className="text-[11px] font-semibold text-muted-foreground mb-1.5">
                              Paso {s.step_order} · {s.step_order === 1 ? "Primer correo" : `+${s.delay_days ?? 0} días`}
                              {Array.isArray(s.variants) && s.variants.length > 0 && <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-primary">{s.variants.length + 1} variantes</span>}
                            </p>
                            <p className="text-sm font-semibold mb-1.5"><CopyText text={s.subject || "(sin asunto)"} /></p>
                            <p className="text-[13px] leading-relaxed text-muted-foreground"><CopyText text={s.body || ""} /></p>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* Sticky send bar */}
        {campaigns && campaigns.length > 0 && (
          <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border/60 bg-background/90 backdrop-blur">
            <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-3">
              <Input value={toEmail} onChange={(e) => { setToEmail(e.target.value); setSentOk(false); }} placeholder="email del cliente" className="h-10 flex-1 text-sm" />
              <Button onClick={sendCopy} disabled={sending || checked.size === 0} className="h-10 gap-2 px-5">
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : sentOk ? <Check className="h-4 w-4" /> : <Send className="h-4 w-4" />}
                {sending ? "Enviando…" : sentOk ? "Enviado" : `Enviar copy (${checked.size})`}
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Client grid ──
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <h1 className="font-display text-2xl font-semibold flex items-center gap-2"><FileText className="h-6 w-6 text-primary" /> Copy</h1>
        <p className="text-sm text-muted-foreground mt-1">Elige un cliente para ver el copy de sus campañas y enviárselo por correo.</p>
      </div>
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Cargando clientes…</div>
      ) : clients.length === 0 ? (
        <Card><CardContent className="py-16 text-center">
          <Users className="mx-auto h-8 w-8 text-muted-foreground/50 mb-3" />
          <p className="text-sm text-muted-foreground">No hay clientes todavía.</p>
        </CardContent></Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {clients.map((c) => (
            <Card key={c.id} className="cursor-pointer transition hover:shadow-md hover:border-primary/40" onClick={() => openClient(c)}>
              <CardContent className="flex items-center gap-3 p-4">
                {c.logo_url
                  ? <img src={c.logo_url} alt="" className="h-10 w-10 rounded-xl object-cover ring-1 ring-border" />
                  : <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white" style={{ backgroundColor: c.brand_color || "#7A5AF8" }}>
                      {(c.company_name || c.email).charAt(0).toUpperCase()}
                    </span>}
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{c.company_name || c.full_name || c.email}</p>
                  <p className="truncate text-xs text-muted-foreground">{c.email}</p>
                </div>
                <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-muted-foreground/60" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
