import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Rocket, Loader2, Building2, Copy, Check, ExternalLink, UserPlus, Upload,
  ChevronDown, Link2, Users, Mail, Send,
} from "lucide-react";
import { PHASES, STATE_META, NEXT_STATE, normalizeStatus, progressPct, buildPhaseEmail, type PhaseState } from "@/lib/onboarding";
import { extractLogoColor } from "@/lib/logoColor";

type Client = {
  id: string; email: string; full_name: string | null; company_name: string | null;
  logo_url: string | null; brand_color: string | null; client_password: string | null;
  onboarding_slug?: string | null; onboarding_status?: unknown;
};

type EmailAccount = { id: string; email: string; status: string };

async function callAdmin(payload: Record<string, unknown>) {
  const { data: { session } } = await supabase.auth.getSession();
  const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-users`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
    body: JSON.stringify(payload),
  });
  return resp.json();
}

// Send a transactional onboarding email from one of the owner's connected accounts.
// is_test:true → send-email skips the sent_emails log and never touches daily limits.
async function sendOnboardingEmail(accountId: string, to: string, subject: string, html: string) {
  const { data: { session } } = await supabase.auth.getSession();
  const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
    body: JSON.stringify({ account_id: accountId, to_email: to, subject, body: html, is_test: true }),
  });
  return resp.json().catch(() => ({ error: "bad response" }));
}

const slugify = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
const cleanSlug = (s: string) => s.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40);

// ── One client's onboarding card: editable slug + 6 phases + progress ──
function OnboardingCard({ c, fromAccountId, onSaved }: { c: Client; fromAccountId: string; onSaved: () => void }) {
  const [slug, setSlug] = useState(c.onboarding_slug || "");
  const [status, setStatus] = useState<PhaseState[]>(() => normalizeStatus(c.onboarding_status));
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sendingPhase, setSendingPhase] = useState<number | null>(null);

  // Re-sync when the parent reloads with fresh server data.
  useEffect(() => { setSlug(c.onboarding_slug || ""); setStatus(normalizeStatus(c.onboarding_status)); }, [c.id, c.onboarding_slug, c.onboarding_status]);

  const pct = progressPct(status);
  const dirty = useMemo(() => {
    const origSlug = c.onboarding_slug || "";
    const origStatus = normalizeStatus(c.onboarding_status);
    return slug !== origSlug || JSON.stringify(status) !== JSON.stringify(origStatus);
  }, [slug, status, c.onboarding_slug, c.onboarding_status]);

  const url = slug ? `${window.location.origin}/o/${slug}` : "";
  const cycle = (i: number) => setStatus((s) => s.map((st, idx) => (idx === i ? NEXT_STATE[st] : st)));
  const copyUrl = () => { if (!url) return; navigator.clipboard?.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1400); };

  const save = async () => {
    setSaving(true);
    const res = await callAdmin({ action: "update_client", user_id: c.id, onboarding_slug: slug || null, onboarding_status: status });
    if (res.error) toast.error(res.error);
    else { toast.success("Onboarding guardado"); onSaved(); }
    setSaving(false);
  };

  // Manual per-phase notify: send the client the email for THIS phase's current state.
  // Persists the state first so the client's portal matches what we just told them.
  const sendPhase = async (i: number) => {
    const st = status[i];
    if (st !== "in_progress" && st !== "done") { toast.message("Marca la fase como 'En curso' o 'Completado' para poder avisar."); return; }
    if (!fromAccountId) { toast.error("Elige primero la cuenta de envío en 'Avisos al cliente' (arriba)."); return; }
    if (!c.email) { toast.error("Este cliente no tiene email."); return; }
    setSendingPhase(i);
    try {
      const upd = await callAdmin({ action: "update_client", user_id: c.id, onboarding_slug: slug || null, onboarding_status: status });
      if (upd.error) { toast.error(upd.error); return; }
      const portalUrl = slug ? `${window.location.origin}/o/${slug}` : null;
      const nextPhaseTitle = st === "done" ? (PHASES[i + 1]?.title ?? null) : null;
      const { subject, html } = buildPhaseEmail({
        state: st, phaseTitle: PHASES[i].title, phaseIndex: i,
        companyName: c.company_name, pct, portalUrl, accent: c.brand_color, nextPhaseTitle,
      });
      const r = await sendOnboardingEmail(fromAccountId, c.email, subject, html);
      if (r?.success) toast.success(`Email enviado a ${c.email}`);
      else toast.error(r?.error || "No se pudo enviar el email");
      onSaved();
    } finally {
      setSendingPhase(null);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            {c.logo_url
              ? <img src={c.logo_url} alt="" className="h-10 w-10 rounded-lg border object-contain" />
              : <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary"><Building2 className="h-5 w-5" /></span>}
            <div className="min-w-0">
              <CardTitle className="truncate text-base">{c.company_name || c.full_name || c.email}</CardTitle>
              <p className="truncate text-xs text-muted-foreground">{c.email}</p>
            </div>
          </div>
          <div className="shrink-0 text-right">
            <p className="font-display text-xl font-bold leading-none text-primary">{pct}%</p>
            <p className="text-[10px] text-muted-foreground">completado</p>
          </div>
        </div>
        {/* progress bar */}
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Access URL */}
        <div className="space-y-1.5 rounded-lg border border-border/60 bg-muted/20 p-3">
          <Label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Link2 className="h-3.5 w-3.5" /> Enlace de acceso del cliente
          </Label>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">{window.location.origin}/o/</span>
            <Input
              value={slug}
              onChange={(e) => setSlug(cleanSlug(e.target.value))}
              placeholder={slugify(c.company_name || c.full_name || "cliente") || "cliente"}
              className="h-8 w-40 text-sm"
            />
            {url && (
              <>
                <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={copyUrl}>
                  {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />} Copiar
                </Button>
                <a href={url} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs text-primary hover:underline">
                  <ExternalLink className="h-3.5 w-3.5" /> Abrir
                </a>
              </>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground">
            El cliente entra ahí con su email y contraseña (los mismos de la plataforma) y ve su progreso con su logo. Gestiona sus credenciales en <Link to="/admin/clients" className="text-primary hover:underline">Portal de Clientes</Link>.
          </p>
        </div>

        {/* Phases */}
        <div className="space-y-2">
          {PHASES.map((p, i) => {
            const st = status[i];
            const meta = STATE_META[st];
            const canSend = st === "in_progress" || st === "done";
            return (
              <div
                key={p.key}
                className="flex w-full items-center gap-2 rounded-lg border border-border/60 p-2.5"
              >
                <button
                  onClick={() => cycle(i)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  title="Clic para cambiar: Pendiente → En curso → Completado"
                >
                  <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${st === "done" ? "bg-emerald-500 text-white" : st === "in_progress" ? "bg-amber-500 text-white" : "bg-muted text-muted-foreground"}`}>
                    {st === "done" ? <Check className="h-3.5 w-3.5" /> : i + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{p.title}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">{p.description}</span>
                  </span>
                </button>
                <span className={`hidden shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold sm:inline ${meta.badge}`}>{meta.label}</span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 shrink-0 gap-1 px-2 text-xs"
                  disabled={!canSend || sendingPhase === i}
                  onClick={() => sendPhase(i)}
                  title={
                    !canSend
                      ? "Marca la fase como En curso o Completado para avisar"
                      : st === "done"
                        ? "Avisar al cliente de que esta fase está terminada"
                        : "Avisar al cliente de que estamos con esta fase"
                  }
                >
                  {sendingPhase === i ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                  Enviar
                </Button>
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-end gap-2">
          {dirty && <span className="mr-auto text-[11px] text-amber-600">Cambios sin guardar</span>}
          <Button size="sm" disabled={!dirty || saving} onClick={save} className="gap-1.5">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Guardar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Compact create-client form (email + password + branding) ──
function CreateClient({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [company, setCompany] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [brandColor, setBrandColor] = useState("#6E58F1");
  const [creating, setCreating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const upload = async (file: File) => {
    if (file.size > 3 * 1024 * 1024) { toast.error("El logo debe pesar menos de 3 MB"); return; }
    setUploading(true);
    try {
      const ext = (file.name.split(".").pop() || "png").toLowerCase();
      const path = `client-logos/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
      const { error } = await supabase.storage.from("godtube-media").upload(path, file, { upsert: true, contentType: file.type });
      if (error) throw error;
      setLogoUrl(supabase.storage.from("godtube-media").getPublicUrl(path).data.publicUrl);
      // Auto-set the brand color from the logo's dominant vivid color (read locally,
      // before upload finishes touching CORS). Falls back silently if unreadable.
      const color = await extractLogoColor(file);
      if (color) setBrandColor(color);
      toast.success("Logo subido");
    } catch (e: any) { toast.error(e.message || "Error al subir el logo"); }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const create = async () => {
    if (!email.trim() || !password.trim()) { toast.error("Email y contraseña son obligatorios"); return; }
    if (password.length < 6) { toast.error("La contraseña debe tener al menos 6 caracteres"); return; }
    setCreating(true);
    const res = await callAdmin({
      action: "create_user", email: email.trim().toLowerCase(), password,
      company_name: company.trim() || null, logo_url: logoUrl.trim() || null, brand_color: brandColor || null,
      allowed_routes: ["/dashboard", "/campaigns", "/unibox", "/stats"],
    });
    if (res.error) toast.error(res.error);
    else {
      toast.success(`Cliente ${email} creado`);
      setEmail(""); setPassword(""); setCompany(""); setLogoUrl(""); setBrandColor("#6E58F1"); setOpen(false);
      onCreated();
    }
    setCreating(false);
  };

  return (
    <Card>
      <CardHeader className="cursor-pointer select-none" onClick={() => setOpen((o) => !o)}>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base"><UserPlus className="h-4 w-4 text-primary" /> Nuevo cliente</CardTitle>
          <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
        </div>
        {!open && <CardDescription>Crea la cuenta del cliente con su acceso y branding, y aparece abajo para gestionar su onboarding.</CardDescription>}
      </CardHeader>
      {open && (
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label className="text-xs">Email *</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="cliente@empresa.com" /></div>
            <div className="space-y-1.5"><Label className="text-xs">Contraseña *</Label><Input type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="mín. 6 caracteres" /></div>
            <div className="space-y-1.5"><Label className="text-xs">Empresa</Label><Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Nombre de la empresa" /></div>
            <div className="space-y-1.5">
              <Label className="text-xs">Color de marca</Label>
              <div className="flex items-center gap-2">
                <input type="color" value={brandColor} onChange={(e) => setBrandColor(e.target.value)} className="h-9 w-12 cursor-pointer rounded border border-border bg-background" />
                <Input value={brandColor} onChange={(e) => setBrandColor(e.target.value)} className="w-28" />
              </div>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Logo</Label>
            <div className="flex flex-wrap items-center gap-2">
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }} />
              <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => fileRef.current?.click()} disabled={uploading}>
                {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Subir logo
              </Button>
              {logoUrl && <img src={logoUrl} alt="logo" className="h-8 max-w-[120px] rounded object-contain" />}
              {logoUrl && <button type="button" className="text-xs text-muted-foreground hover:text-destructive" onClick={() => setLogoUrl("")}>Quitar</button>}
            </div>
          </div>
          <Button onClick={create} disabled={creating} className="gap-2">
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} Crear cliente
          </Button>
        </CardContent>
      )}
    </Card>
  );
}

// ── Sender account for onboarding notifications (owner-level setting) ──
function SenderPicker({ accounts, value, onChange }: { accounts: EmailAccount[]; value: string; onChange: (id: string) => void }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base"><Mail className="h-4 w-4 text-primary" /> Avisos al cliente</CardTitle>
        <CardDescription>
          Cada fase tiene un botón <b>Enviar</b>: avisa al cliente por email de que esa fase está <b>en curso</b> o ya <b>completada</b> (con la siguiente tarea). Elige desde qué cuenta salen.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {accounts.length === 0 ? (
          <p className="text-sm text-amber-600">
            No tienes cuentas de email conectadas en este perfil. Conecta una (Gmail, IONOS…) en <Link to="/email-accounts" className="text-primary hover:underline">Cuentas Email</Link> y aquí podrás elegirla.
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={value}
              onChange={(e) => onChange(e.target.value)}
              className="h-9 min-w-[240px] rounded-md border border-border bg-background px-2 text-sm"
            >
              <option value="">— Sin avisos (no enviar email) —</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.email}{a.status !== "connected" ? ` (${a.status})` : ""}</option>
              ))}
            </select>
            {value && <span className="inline-flex items-center gap-1 text-xs text-emerald-600"><Check className="h-3.5 w-3.5" /> Avisos activados</span>}
          </div>
        )}
        <p className="mt-2 text-[11px] text-muted-foreground">
          Solo aparecen las cuentas conectadas en <b>este</b> perfil. Estos avisos no gastan el límite diario de envío ni afectan a tus campañas.
        </p>
      </CardContent>
    </Card>
  );
}

export default function Onboarding() {
  const { user } = useAuth();
  const [access, setAccess] = useState<"loading" | "yes" | "no">("loading");
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(false);
  const [accounts, setAccounts] = useState<EmailAccount[]>([]);
  const [fromAccountId, setFromAccountId] = useState("");
  const backfillingRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!user) return;
    (async () => {
      const [{ data: r }, { data: p }] = await Promise.all([
        supabase.from("user_roles").select("role").eq("user_id", user.id).single(),
        (supabase as any).from("profiles").select("is_client_manager, onboarding_from_account_id").eq("user_id", user.id).single(),
      ]);
      setAccess(r?.role === "admin" || (p as any)?.is_client_manager ? "yes" : "no");
      if ((p as any)?.onboarding_from_account_id) setFromAccountId((p as any).onboarding_from_account_id);
    })();
  }, [user]);

  const loadClients = useCallback(async () => {
    setLoading(true);
    const res = await callAdmin({ action: "list_clients" });
    if (res.error) toast.error(res.error);
    else setClients(res.clients || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (access !== "yes") return;
    loadClients();
    supabase.from("email_accounts").select("id, email, status").not("smtp_host", "is", null).order("email")
      .then(({ data }) => setAccounts((data as EmailAccount[]) || []));
  }, [access, loadClients]);

  // Auto-assign a stable access link (slug) to any client that doesn't have one yet,
  // and persist it ONCE — so the owner never has to click "Generar". Uniqueness is
  // resolved against the already-loaded clients (case-insensitive, same as the DB index).
  useEffect(() => {
    const missing = clients.filter((c) => !c.onboarding_slug && !backfillingRef.current.has(c.id));
    if (missing.length === 0) return;
    missing.forEach((c) => backfillingRef.current.add(c.id));
    (async () => {
      const taken = new Set(clients.map((c) => (c.onboarding_slug || "").toLowerCase()).filter(Boolean));
      const uniqueSlug = (base: string) => {
        let s = base || "cliente", i = 2;
        while (taken.has(s)) s = `${base}-${i++}`;
        taken.add(s);
        return s;
      };
      let changed = false;
      for (const c of missing) {
        const base = slugify(c.company_name || c.full_name || c.email.split("@")[0]) || "cliente";
        const res = await callAdmin({ action: "update_client", user_id: c.id, onboarding_slug: uniqueSlug(base) });
        if (!res?.error) changed = true;
      }
      if (changed) loadClients();
    })();
  }, [clients, loadClients]);

  const changeSender = async (id: string) => {
    setFromAccountId(id);
    const { error } = await (supabase as any).rpc("set_onboarding_from_account", { p_account_id: id || null });
    if (error) toast.error("No se pudo guardar la cuenta de envío");
  };

  if (access === "loading") return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (access === "no") return <Navigate to="/dashboard" replace />;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="flex items-center gap-2 font-display text-2xl font-bold tracking-tight">
          <Rocket className="h-6 w-6 text-primary" /> Onboarding
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Sigue el alta de cada cliente por sus 6 fases. Comparte su enlace de acceso y ellos ven su progreso en tiempo real.
        </p>
      </div>

      <SenderPicker accounts={accounts} value={fromAccountId} onChange={changeSender} />

      <CreateClient onCreated={loadClients} />

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : clients.length === 0 ? (
        <Card><CardContent className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
          <Users className="h-8 w-8 opacity-50" />
          <p className="text-sm">Aún no hay clientes. Crea el primero arriba.</p>
        </CardContent></Card>
      ) : (
        <div className="space-y-4">
          {clients.map((c) => <OnboardingCard key={c.id} c={c} fromAccountId={fromAccountId} onSaved={loadClients} />)}
        </div>
      )}
    </div>
  );
}
