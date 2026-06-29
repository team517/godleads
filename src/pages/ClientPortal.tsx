import { useCallback, useEffect, useState } from "react";
import { Navigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Users, UserPlus, Loader2, Trash2, Pencil, ArrowLeft, Building2 } from "lucide-react";

const SECTIONS = [
  { path: "/dashboard", label: "Dashboard" },
  { path: "/email-accounts", label: "Cuentas Email" },
  { path: "/campaigns", label: "Campañas" },
  { path: "/leads", label: "Leads" },
  { path: "/unibox", label: "Unibox" },
  { path: "/stats", label: "Estadísticas" },
  { path: "/ai-prompts", label: "IA" },
  { path: "/workflows", label: "Nodos" },
  { path: "/godtube", label: "Tutorial" },
];
const DEFAULT_ROUTES = ["/dashboard", "/email-accounts", "/campaigns", "/leads", "/unibox"];

type Client = {
  id: string; email: string; full_name: string | null; company_name: string | null;
  allowed_routes: string[] | null; logo_url: string | null; brand_color: string | null; created_at: string;
};

async function callAdmin(payload: Record<string, unknown>) {
  const { data: { session } } = await supabase.auth.getSession();
  const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-users`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
    body: JSON.stringify(payload),
  });
  return resp.json();
}

function SectionPicker({ selected, onToggle }: { selected: string[]; onToggle: (path: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {SECTIONS.map((s) => {
        const on = selected.includes(s.path);
        return (
          <label key={s.path} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${on ? "border-primary/40 bg-primary/5" : "border-border hover:bg-muted/40"}`}>
            <Checkbox checked={on} onCheckedChange={() => onToggle(s.path)} />
            {s.label}
          </label>
        );
      })}
    </div>
  );
}

export default function ClientPortal() {
  const { user } = useAuth();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(false);

  // Create form
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [company, setCompany] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [brandColor, setBrandColor] = useState("#6E58F1");
  const [routes, setRoutes] = useState<string[]>(DEFAULT_ROUTES);
  const [creating, setCreating] = useState(false);

  // Edit dialog
  const [editing, setEditing] = useState<Client | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  useEffect(() => {
    if (!user) return;
    supabase.from("user_roles").select("role").eq("user_id", user.id).single()
      .then(({ data }) => setIsAdmin(data?.role === "admin"));
  }, [user]);

  const loadClients = useCallback(async () => {
    setLoading(true);
    const res = await callAdmin({ action: "list_clients" });
    if (res.error) toast.error(res.error);
    else setClients(res.clients || []);
    setLoading(false);
  }, []);

  useEffect(() => { if (isAdmin) loadClients(); }, [isAdmin, loadClients]);

  const toggle = (path: string) => setRoutes((r) => r.includes(path) ? r.filter((p) => p !== path) : [...r, path]);

  const createClient = async () => {
    if (!email.trim() || !password.trim()) { toast.error("Email y contraseña son obligatorios"); return; }
    if (password.length < 6) { toast.error("La contraseña debe tener al menos 6 caracteres"); return; }
    if (routes.length === 0) { toast.error("Selecciona al menos una sección"); return; }
    setCreating(true);
    const res = await callAdmin({
      action: "create_user",
      email: email.trim().toLowerCase(), password,
      full_name: fullName.trim() || null, company_name: company.trim() || null,
      allowed_routes: routes, logo_url: logoUrl.trim() || null, brand_color: brandColor || null,
    });
    if (res.error) toast.error(res.error);
    else {
      toast.success(`Cliente ${email} creado`);
      setEmail(""); setPassword(""); setFullName(""); setCompany(""); setLogoUrl(""); setBrandColor("#6E58F1"); setRoutes(DEFAULT_ROUTES);
      loadClients();
    }
    setCreating(false);
  };

  const removeClient = async (c: Client) => {
    if (!confirm(`¿Eliminar el cliente ${c.email}? Esto borra su cuenta.`)) return;
    const res = await callAdmin({ action: "delete", user_id: c.id });
    if (res.error) toast.error(res.error);
    else { toast.success("Cliente eliminado"); loadClients(); }
  };

  if (isAdmin === null) return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (!isAdmin) return <Navigate to="/dashboard" replace />;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight flex items-center gap-2">
            <Users className="h-6 w-6 text-primary" /> Portal de Clientes
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Crea cuentas de cliente con su propio acceso y branding.</p>
        </div>
        <Button asChild variant="outline" size="sm" className="gap-2"><Link to="/admin"><ArrowLeft className="h-3.5 w-3.5" /> Admin</Link></Button>
      </div>

      {/* Create client */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><UserPlus className="h-4 w-4 text-primary" /> Nuevo cliente</CardTitle>
          <CardDescription>Cuenta + contraseña, branding y a qué secciones tiene acceso.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5"><Label>Email *</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="cliente@empresa.com" /></div>
            <div className="space-y-1.5"><Label>Contraseña *</Label><Input type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="mín. 6 caracteres" /></div>
            <div className="space-y-1.5"><Label>Nombre</Label><Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Nombre del cliente" /></div>
            <div className="space-y-1.5"><Label>Empresa</Label><Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Nombre de la empresa" /></div>
          </div>

          <div className="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-3">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Branding</Label>
            <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
              <div className="space-y-1.5"><Label className="text-xs">Logo (URL)</Label><Input value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://…/logo.png" /></div>
              <div className="space-y-1.5"><Label className="text-xs">Color de marca</Label>
                <div className="flex items-center gap-2">
                  <input type="color" value={brandColor} onChange={(e) => setBrandColor(e.target.value)} className="h-9 w-12 cursor-pointer rounded border border-border bg-background" />
                  <Input value={brandColor} onChange={(e) => setBrandColor(e.target.value)} className="w-28" />
                </div>
              </div>
            </div>
            {logoUrl && <div className="flex items-center gap-2 pt-1"><span className="text-xs text-muted-foreground">Vista previa:</span><img src={logoUrl} alt="logo" className="h-7 max-w-[150px] object-contain" /></div>}
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Secciones con acceso</Label>
            <SectionPicker selected={routes} onToggle={toggle} />
          </div>

          <Button onClick={createClient} disabled={creating} className="gap-2">
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} Crear cliente
          </Button>
        </CardContent>
      </Card>

      {/* Client list */}
      <Card>
        <CardHeader><CardTitle className="text-base">Clientes ({clients.length})</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : clients.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aún no hay clientes. Crea el primero arriba.</p>
          ) : (
            <div className="divide-y divide-border/60">
              {clients.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="flex items-center gap-3 min-w-0">
                    {c.logo_url ? <img src={c.logo_url} alt="" className="h-8 w-8 rounded object-contain" /> : <span className="flex h-8 w-8 items-center justify-center rounded bg-primary/10 text-primary"><Building2 className="h-4 w-4" /></span>}
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{c.company_name || c.full_name || c.email}</p>
                      <p className="truncate text-xs text-muted-foreground">{c.email} · {(c.allowed_routes || []).length} secciones</p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {c.brand_color && <span className="h-4 w-4 rounded-full border" style={{ background: c.brand_color }} title={c.brand_color} />}
                    <Button size="sm" variant="ghost" className="h-8 gap-1 text-xs" onClick={() => setEditing(c)}><Pencil className="h-3.5 w-3.5" /> Editar</Button>
                    <Button size="sm" variant="ghost" className="h-8 text-destructive hover:text-destructive" onClick={() => removeClient(c)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {editing && (
        <EditClientDialog
          client={editing}
          saving={savingEdit}
          onClose={() => setEditing(null)}
          onSave={async (updates) => {
            setSavingEdit(true);
            const res = await callAdmin({ action: "update_client", user_id: editing.id, ...updates });
            if (res.error) toast.error(res.error);
            else { toast.success("Cliente actualizado"); setEditing(null); loadClients(); }
            setSavingEdit(false);
          }}
        />
      )}
    </div>
  );
}

function EditClientDialog({ client, saving, onClose, onSave }: {
  client: Client; saving: boolean; onClose: () => void;
  onSave: (u: Record<string, unknown>) => void;
}) {
  const [company, setCompany] = useState(client.company_name || "");
  const [logoUrl, setLogoUrl] = useState(client.logo_url || "");
  const [brandColor, setBrandColor] = useState(client.brand_color || "#6E58F1");
  const [routes, setRoutes] = useState<string[]>(client.allowed_routes || []);
  const [newPassword, setNewPassword] = useState("");
  const toggle = (path: string) => setRoutes((r) => r.includes(path) ? r.filter((p) => p !== path) : [...r, path]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle className="font-display">Editar · {client.email}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label className="text-xs">Empresa</Label><Input value={company} onChange={(e) => setCompany(e.target.value)} /></div>
            <div className="space-y-1.5"><Label className="text-xs">Nueva contraseña</Label><Input type="text" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="(dejar vacío = sin cambio)" /></div>
            <div className="space-y-1.5"><Label className="text-xs">Logo (URL)</Label><Input value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} /></div>
            <div className="space-y-1.5"><Label className="text-xs">Color de marca</Label>
              <div className="flex items-center gap-2">
                <input type="color" value={brandColor} onChange={(e) => setBrandColor(e.target.value)} className="h-9 w-12 cursor-pointer rounded border border-border bg-background" />
                <Input value={brandColor} onChange={(e) => setBrandColor(e.target.value)} className="w-24" />
              </div>
            </div>
          </div>
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Secciones con acceso</Label>
            <SectionPicker selected={routes} onToggle={toggle} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button disabled={saving || routes.length === 0} onClick={() => onSave({
            company_name: company.trim() || null, logo_url: logoUrl.trim() || null,
            brand_color: brandColor || null, allowed_routes: routes,
            ...(newPassword ? { password: newPassword } : {}),
          })}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
