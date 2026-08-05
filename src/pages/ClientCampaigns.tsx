import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { parseCSVToObjects } from "@/lib/csv-parser";
import {
  Megaphone, Loader2, Building2, Users, ArrowLeft, Upload, Sparkles, Wand2,
  Trash2, Plus, Send, Check, ChevronRight, MailWarning,
} from "lucide-react";

type Client = {
  id: string; email: string; full_name: string | null; company_name: string | null;
  logo_url: string | null; brand_color: string | null;
};
type Variant = { subject: string; body: string };
type Step = { subject: string; body: string; delay_days: number; variants: Variant[] };
type LeadRow = { email: string; custom_fields: Record<string, string> };

async function callAdmin(payload: Record<string, unknown>) {
  const { data: { session } } = await supabase.auth.getSession();
  const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-users`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
    body: JSON.stringify(payload),
  });
  return resp.json();
}

const LANGUAGES = ["Español de España", "Español (LatAm)", "Inglés", "Francés", "Alemán", "Italiano", "Portugués", "Catalán"];
const DEFAULT_DELAYS = [0, 3, 4, 5, 6, 7];

// ───────────────────────── Campaign builder for one client ─────────────────────────
function Builder({ client, onBack, onCreated }: { client: Client; onBack: () => void; onCreated: () => void }) {
  const [name, setName] = useState(`Campaña ${client.company_name || client.full_name || ""}`.trim());
  const [briefing, setBriefing] = useState("");
  const [language, setLanguage] = useState(LANGUAGES[0]);
  const [tone, setTone] = useState("cercano y profesional");
  const [goal, setGoal] = useState("conseguir una reunión / llamada");
  const [numSteps, setNumSteps] = useState(3);
  const [numVariants, setNumVariants] = useState(1);

  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [parsing, setParsing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [steps, setSteps] = useState<Step[]>([]);
  const [generating, setGenerating] = useState(false);
  const [creating, setCreating] = useState(false);

  // Options (recommended defaults)
  const [stopOnReply, setStopOnReply] = useState(true);
  const [firstTextOnly, setFirstTextOnly] = useState(true);
  const [textOnly, setTextOnly] = useState(false);
  const [breakThread, setBreakThread] = useState(0); // 0 = keep thread always
  const [includeUnsub, setIncludeUnsub] = useState(false);

  const handleCsv = async (file: File) => {
    setParsing(true);
    try {
      const text = await file.text();
      const res = parseCSVToObjects(text);
      if ("error" in res) { toast.error(res.error || "CSV no válido"); return; }
      const seen = new Set<string>();
      const rows: LeadRow[] = [];
      for (const row of res.rows) {
        const email = String((row as any).email || "").trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || seen.has(email)) continue;
        seen.add(email);
        const cf: Record<string, string> = {};
        Object.entries(row).forEach(([k, v]) => { if (k !== "email" && String(v ?? "").trim()) cf[k] = String(v).trim(); });
        rows.push({ email, custom_fields: cf });
      }
      if (!rows.length) { toast.error("No se encontraron emails válidos en el CSV"); return; }
      setLeads(rows);
      toast.success(`${rows.length} leads cargados (sin repetidos)`);
    } catch (e: any) {
      toast.error(e.message || "Error leyendo el CSV");
    } finally {
      setParsing(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const generate = async () => {
    if (!briefing.trim()) { toast.error("Escribe el briefing del cliente primero"); return; }
    setGenerating(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-campaign`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ briefing, language, tone, goal, num_steps: numSteps, num_variants: numVariants }),
      });
      const j = await resp.json();
      if (j.error) { toast.error(j.error); }
      else {
        const st: Step[] = (j.steps || []).map((s: any, i: number) => ({
          subject: s.subject || "", body: s.body || "",
          delay_days: i === 0 ? 0 : (DEFAULT_DELAYS[i] ?? 3),
          variants: Array.isArray(s.variants) ? s.variants.map((v: any) => ({ subject: v.subject || "", body: v.body || "" })) : [],
        }));
        setSteps(st);
        toast.success(`Secuencia de ${st.length} email(s) generada`);
      }
    } catch (e: any) { toast.error(String(e?.message || e)); }
    setGenerating(false);
  };

  const updateStep = (i: number, patch: Partial<Step>) => setSteps((s) => s.map((st, idx) => (idx === i ? { ...st, ...patch } : st)));
  const updateVariant = (si: number, vi: number, patch: Partial<Variant>) =>
    setSteps((s) => s.map((st, idx) => idx !== si ? st : { ...st, variants: st.variants.map((v, j) => j === vi ? { ...v, ...patch } : v) }));
  const removeVariant = (si: number, vi: number) =>
    setSteps((s) => s.map((st, idx) => idx !== si ? st : { ...st, variants: st.variants.filter((_, j) => j !== vi) }));
  const addVariant = (si: number) =>
    setSteps((s) => s.map((st, idx) => idx !== si ? st : { ...st, variants: [...st.variants, { subject: st.subject, body: st.body }] }));

  const create = async () => {
    if (!name.trim()) { toast.error("Ponle un nombre a la campaña"); return; }
    if (steps.length === 0) { toast.error("Genera la secuencia con IA primero"); return; }
    if (steps.some((s) => !s.subject.trim() || !s.body.trim())) { toast.error("Hay algún email sin asunto o cuerpo"); return; }
    setCreating(true);
    const res = await callAdmin({
      action: "create_client_campaign",
      client_user_id: client.id,
      name: name.trim(),
      options: {
        stop_on_reply: stopOnReply,
        first_email_text_only: firstTextOnly,
        text_only_emails: textOnly,
        break_thread_after: breakThread,
        include_unsubscribe: includeUnsub,
      },
      steps: steps.map((s, i) => ({ subject: s.subject, body: s.body, delay_days: i === 0 ? 0 : s.delay_days, variants: s.variants })),
      leads,
    });
    if (res.error) toast.error(res.error);
    else {
      toast.success(`Campaña creada en la cuenta de ${client.company_name || client.email} · ${res.leads} leads`);
      onCreated();
    }
    setCreating(false);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={onBack}><ArrowLeft className="h-4 w-4" /> Clientes</Button>
        <div className="flex min-w-0 items-center gap-2">
          {client.logo_url
            ? <img src={client.logo_url} alt="" className="h-8 w-8 rounded-lg border object-contain" />
            : <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary"><Building2 className="h-4 w-4" /></span>}
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{client.company_name || client.full_name || client.email}</p>
            <p className="truncate text-[11px] text-muted-foreground">Nueva campaña · se crea en su cuenta</p>
          </div>
        </div>
      </div>

      {/* 1. Briefing + estructura */}
      <Section n={1} title="Briefing y estructura" desc="Pega lo que te pasó el cliente (a qué se dedica, oferta, cliente ideal, tono, enlace). La IA escribe la secuencia a partir de esto.">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Nombre de la campaña</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Campaña Q3 — reuniones" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Briefing del cliente</Label>
            <textarea
              value={briefing} onChange={(e) => setBriefing(e.target.value)} rows={6}
              placeholder="Ej: Agencia de SEO local para clínicas dentales. Ayudan a llenar la agenda con pacientes de su zona. Prueba social: +30 clínicas. Ofrecen auditoría gratis. Tono cercano. CTA: 15 min de llamada. Calendario: calendly.com/…"
              className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Idioma</Label>
              <select value={language} onChange={(e) => setLanguage(e.target.value)} className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm">
                {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Tono</Label>
              <Input value={tone} onChange={(e) => setTone(e.target.value)} placeholder="cercano y profesional" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Objetivo (CTA)</Label>
              <Input value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="conseguir una reunión / llamada" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Emails (steps)</Label>
                <select value={numSteps} onChange={(e) => setNumSteps(Number(e.target.value))} className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm">
                  {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Variantes</Label>
                <select value={numVariants} onChange={(e) => setNumVariants(Number(e.target.value))} className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm">
                  {[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
            </div>
          </div>
          <Button onClick={generate} disabled={generating || !briefing.trim()} className="gap-2">
            {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
            {steps.length ? "Regenerar con IA" : "Generar secuencia con IA"}
          </Button>
        </div>
      </Section>

      {/* 2. Mensajes (preview + editable) */}
      {steps.length > 0 && (
        <Section n={2} title="Mensajes (IA)" desc="Revísalos y edita lo que quieras. Usa {{first_name}} y {{company_name}} — se rellenan por lead.">
          <div className="space-y-4">
            {steps.map((s, i) => (
              <div key={i} className="rounded-xl border border-border/70 p-3.5">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">{i + 1}</span>
                    {i === 0 ? "Email inicial" : `Follow-up ${i}`}
                  </span>
                  {i > 0 && (
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      Enviar
                      <Input type="number" min={1} value={s.delay_days} onChange={(e) => updateStep(i, { delay_days: Math.max(1, Number(e.target.value) || 1) })} className="h-7 w-16 text-xs" />
                      días tras el anterior
                    </span>
                  )}
                </div>
                <div className="space-y-2">
                  <Input value={s.subject} onChange={(e) => updateStep(i, { subject: e.target.value })} placeholder="Asunto" className="text-sm font-medium" />
                  <textarea value={s.body} onChange={(e) => updateStep(i, { body: e.target.value })} rows={4}
                    className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary/40" />
                </div>
                {/* Variants */}
                {s.variants.length > 0 && (
                  <div className="mt-3 space-y-2 border-t border-border/50 pt-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Variantes (A/B)</p>
                    {s.variants.map((v, vi) => (
                      <div key={vi} className="rounded-lg border border-dashed border-border/70 p-2.5">
                        <div className="mb-1.5 flex items-center justify-between">
                          <span className="text-[11px] font-medium text-muted-foreground">Variante {String.fromCharCode(66 + vi)}</span>
                          <button onClick={() => removeVariant(i, vi)} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
                        </div>
                        <div className="space-y-1.5">
                          <Input value={v.subject} onChange={(e) => updateVariant(i, vi, { subject: e.target.value })} placeholder="Asunto variante" className="h-8 text-sm" />
                          <textarea value={v.body} onChange={(e) => updateVariant(i, vi, { body: e.target.value })} rows={3}
                            className="w-full resize-y rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <Button variant="ghost" size="sm" className="mt-2 h-7 gap-1 text-xs text-muted-foreground" onClick={() => addVariant(i)}>
                  <Plus className="h-3.5 w-3.5" /> Añadir variante
                </Button>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* 3. Leads */}
      <Section n={3} title="Leads" desc="Sube el CSV (columna email obligatoria). Se quitan repetidos y los bloqueados no se suben.">
        <div className="flex flex-wrap items-center gap-3">
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleCsv(f); }} />
          <Button variant="outline" className="gap-2" disabled={parsing} onClick={() => fileRef.current?.click()}>
            {parsing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Subir CSV
          </Button>
          {leads.length > 0 && <span className="inline-flex items-center gap-1.5 text-sm text-emerald-600"><Check className="h-4 w-4" /> {leads.length.toLocaleString()} leads listos</span>}
          <span className="text-xs text-muted-foreground">Opcional ahora — puedes añadirlos después en su cuenta.</span>
        </div>
      </Section>

      {/* 4. Opciones */}
      <Section n={4} title="Opciones de la campaña" desc="Ajustes recomendados de entregabilidad. Se aplican a la campaña del cliente.">
        <div className="space-y-2.5">
          <OptRow checked={stopOnReply} onChange={setStopOnReply} title="Parar al recibir respuesta" desc="No se envían más follow-ups a quien ya te contestó." />
          <OptRow checked={firstTextOnly} onChange={setFirstTextOnly} title="Primer email en solo texto (recomendado)" desc="Mejor entregabilidad: el primer correo va sin HTML." />
          <OptRow checked={textOnly} onChange={setTextOnly} title="Todos los emails en solo texto" desc="Envía toda la secuencia sin HTML." />
          <OptRow checked={includeUnsub} onChange={setIncludeUnsub} title="Incluir enlace para darse de baja" desc="Añade un pie de opt-out (RGPD)." />
          <div className="flex flex-col gap-1.5 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium">Romper hilo</p>
              <p className="text-xs text-muted-foreground">Desde qué follow-up deja de ir como respuesta y sale como email nuevo.</p>
            </div>
            <select value={breakThread} onChange={(e) => setBreakThread(Number(e.target.value))} className="h-9 rounded-md border border-border bg-background px-2 text-sm">
              <option value={0}>Mantener hilo siempre</option>
              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>A partir del follow-up {n}</option>)}
            </select>
          </div>
        </div>
      </Section>

      {/* Create */}
      <div className="sticky bottom-3 z-10 flex flex-col items-stretch gap-2 rounded-xl border bg-background/95 p-3 shadow-lg backdrop-blur sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">
          {steps.length ? `${steps.length} email(s)` : "Sin secuencia"} · {leads.length.toLocaleString()} leads · se crea como <b>borrador</b> en la cuenta del cliente.
        </p>
        <Button className="gap-2" disabled={creating || steps.length === 0 || !name.trim()} onClick={create}>
          {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Crear campaña para el cliente
        </Button>
      </div>
    </div>
  );
}

function Section({ n, title, desc, children }: { n: number; title: string; desc?: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2.5 text-base">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">{n}</span>
          {title}
        </CardTitle>
        {desc && <CardDescription>{desc}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function OptRow({ checked, onChange, title, desc }: { checked: boolean; onChange: (v: boolean) => void; title: string; desc: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3">
      <Checkbox checked={checked} onCheckedChange={(v) => onChange(!!v)} className="mt-0.5" />
      <span>
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-muted-foreground">{desc}</span>
      </span>
    </label>
  );
}

// ───────────────────────── Page ─────────────────────────
export default function ClientCampaigns() {
  const { user } = useAuth();
  const [access, setAccess] = useState<"loading" | "yes" | "no">("loading");
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Client | null>(null);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const [{ data: r }, { data: p }] = await Promise.all([
        supabase.from("user_roles").select("role").eq("user_id", user.id).single(),
        (supabase as any).from("profiles").select("is_client_manager").eq("user_id", user.id).single(),
      ]);
      setAccess(r?.role === "admin" || (p as any)?.is_client_manager ? "yes" : "no");
    })();
  }, [user]);

  const loadClients = useCallback(async () => {
    setLoading(true);
    const res = await callAdmin({ action: "list_clients" });
    if (res.error) toast.error(res.error);
    else setClients(res.clients || []);
    setLoading(false);
  }, []);

  useEffect(() => { if (access === "yes") loadClients(); }, [access, loadClients]);

  if (access === "loading") return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (access === "no") return <Navigate to="/dashboard" replace />;

  if (selected) {
    return <Builder client={selected} onBack={() => setSelected(null)} onCreated={() => { setSelected(null); }} />;
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="flex items-center gap-2 font-display text-2xl font-bold tracking-tight">
          <Megaphone className="h-6 w-6 text-primary" /> Crear campaña
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Elige un cliente y crea su campaña con la IA (mensajes, variantes y steps). Se crea como borrador en su cuenta.
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : clients.length === 0 ? (
        <Card><CardContent className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
          <Users className="h-8 w-8 opacity-50" />
          <p className="text-sm">Aún no hay clientes. Créalos en Portal de Clientes u Onboarding.</p>
        </CardContent></Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {clients.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelected(c)}
              className="group flex items-center gap-3 rounded-xl border bg-card p-4 text-left transition-colors hover:border-primary/40 hover:bg-primary/5"
            >
              {c.logo_url
                ? <img src={c.logo_url} alt="" className="h-10 w-10 rounded-lg border object-contain" />
                : <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary"><Building2 className="h-5 w-5" /></span>}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{c.company_name || c.full_name || c.email}</p>
                <p className="truncate text-xs text-muted-foreground">{c.email}</p>
              </div>
              <span className="flex items-center gap-1 text-xs font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
                Crear <ChevronRight className="h-4 w-4" />
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
