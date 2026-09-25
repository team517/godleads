import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Navigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Search, Users, Trash2, RefreshCw, Mail, Building2, Calendar, CreditCard, Shield, Loader2, KeyRound, Eye, EyeOff, Copy } from "lucide-react";
import { toast } from "sonner";
import { PLAN_CONFIG } from "@/contexts/SubscriptionContext";
import {
  type AdminUserRaw, type TipoUsuario, type EstadoPanel, TIPO_LABEL,
  tipoDeUsuario, estadoPanel, coincideBusqueda, accesoDe,
} from "@/lib/admin-users";

type AdminUser = AdminUserRaw;

const FILTROS: { id: "todos" | TipoUsuario; label: string }[] = [
  { id: "todos", label: "Todos" },
  { id: "registro", label: "Registro propio" },
  { id: "cliente", label: "Clientes" },
  { id: "invitado", label: "Acceso gratis" },
  { id: "equipo", label: "Equipo" },
];

function planLabel(tier: string): string {
  if (!tier || tier === "free") return "Sin plan";
  return PLAN_CONFIG[tier as keyof typeof PLAN_CONFIG]?.label || tier;
}

function statusColor(estado: EstadoPanel): string {
  switch (estado) {
    case "pago": return "bg-success/10 text-success border-success/30";
    case "gratis": return "bg-muted text-muted-foreground border-border";
    case "prueba": return "bg-warning/10 text-warning border-warning/30";
    case "caducada": return "bg-destructive/10 text-destructive border-destructive/30";
  }
}

function statusDot(estado: EstadoPanel): string {
  switch (estado) {
    case "pago": return "bg-emerald-500";
    case "gratis": return "bg-muted-foreground";
    case "prueba": return "bg-amber-500";
    case "caducada": return "bg-red-500";
  }
}

const fecha = (iso: string | null, largo = false) => iso
  ? new Date(iso).toLocaleDateString("es", largo ? { day: "numeric", month: "long", year: "numeric" } : { day: "numeric", month: "short", year: "numeric" })
  : "—";

async function copiar(texto: string, que: string) {
  try { await navigator.clipboard.writeText(texto); toast.success(`${que} copiado`); }
  catch { toast.error("No se pudo copiar"); }
}

export default function AdminPanel() {
  const { user } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filtro, setFiltro] = useState<"todos" | TipoUsuario>("todos");
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [togglingRole, setTogglingRole] = useState(false);

  const checkAdmin = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .single();
    setIsAdmin(data?.role === "admin");
  }, [user]);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-users`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ action: "list" }),
      });
      const result = await resp.json();
      if (result.error) {
        toast.error(result.error);
      } else {
        const lista: AdminUser[] = result.users || [];
        setUsers(lista);
        // El detalle abierto se refresca con los datos nuevos (rol cambiado, etc.).
        setSelectedUser((prev) => (prev ? lista.find((u) => u.id === prev.id) || null : null));
      }
    } catch (e: any) {
      toast.error(`Error: ${e.message}`);
    }
    setLoading(false);
  }, []);

  useEffect(() => { checkAdmin(); }, [checkAdmin]);
  useEffect(() => { if (isAdmin) loadUsers(); }, [isAdmin, loadUsers]);

  const handleDelete = async (userId: string) => {
    setDeleting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-users`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ action: "delete", user_id: userId }),
      });
      const result = await resp.json();
      if (result.error) toast.error(result.error);
      else {
        toast.success("Usuario eliminado");
        setSelectedUser(null);
        loadUsers();
      }
    } catch (e: any) { toast.error(e.message); }
    setDeleting(false);
  };

  const handleToggleRole = async (userId: string, newRole: string) => {
    setTogglingRole(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-users`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ action: "set_role", user_id: userId, role: newRole }),
      });
      const result = await resp.json();
      if (result.error) toast.error(result.error);
      else {
        toast.success(`Rol cambiado a ${newRole}`);
        loadUsers();
      }
    } catch (e: any) { toast.error(e.message); }
    setTogglingRole(false);
  };

  if (isAdmin === null) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!isAdmin) return <Navigate to="/dashboard" replace />;

  const now = Date.now();
  const conTipo = users.map((u) => ({ u, tipo: tipoDeUsuario(u), est: estadoPanel(u, now) }));
  const porTipo = (t: "todos" | TipoUsuario) => (t === "todos" ? conTipo.length : conTipo.filter((x) => x.tipo === t).length);
  const filtered = conTipo.filter((x) => (filtro === "todos" || x.tipo === filtro) && coincideBusqueda(x.u, search));

  const stats = {
    total: users.length,
    paid: conTipo.filter((x) => x.est.estado === "pago").length,
    trial: conTipo.filter((x) => x.est.estado === "prueba").length,
    expired: conTipo.filter((x) => x.est.estado === "caducada").length,
  };

  return (
    <div className="flex flex-col gap-6 pb-10">
      {/* Header */}
      <div className="flex items-center justify-between px-1 pb-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-[-0.03em] flex items-center gap-2">
            <Shield className="h-6 w-6 text-primary" /> Admin Panel
          </h1>
          <p className="text-[15px] text-muted-foreground mt-1">
            {stats.total} usuarios · {porTipo("registro")} con registro propio · {porTipo("cliente")} clientes creados por ti · {stats.paid} pagando
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-2" onClick={loadUsers} disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Actualizar
        </Button>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-1 pb-4">
        {[
          { label: "Total", value: stats.total, color: "text-foreground", bg: "bg-muted" },
          { label: "Pagando", value: stats.paid, color: "text-success", bg: "bg-success/10" },
          { label: "En prueba", value: stats.trial, color: "text-warning", bg: "bg-warning/10" },
          { label: "Prueba acabada sin pagar", value: stats.expired, color: "text-destructive", bg: "bg-destructive/10" },
        ].map(s => (
          <div key={s.label} className={`rounded-lg border p-3 ${s.bg}`}>
            <p className="text-xs text-muted-foreground">{s.label}</p>
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {loading && users.length === 0 ? (
        <div className="flex h-[60vh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : (
        <div className="flex h-[70vh] gap-0 rounded-lg border bg-card overflow-hidden min-h-0">
          {/* User list */}
          <div className="w-[400px] flex-shrink-0 flex flex-col border-r bg-muted/20">
            <div className="p-3 border-b bg-card space-y-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Buscar por correo, nombre o empresa…"
                  className="pl-9 h-8 text-sm bg-muted/40 border-0 focus-visible:ring-1"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
              <div className="flex flex-wrap gap-1">
                {FILTROS.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setFiltro(f.id)}
                    className={`rounded-md border px-2 py-0.5 text-[12px] font-medium transition-colors ${
                      filtro === f.id ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {f.label} <span className="tabular-nums opacity-70">{porTipo(f.id)}</span>
                  </button>
                ))}
              </div>
            </div>
            <ScrollArea className="flex-1">
              {filtered.map(({ u, tipo, est }) => {
                const isActive = selectedUser?.id === u.id;
                return (
                  <button
                    key={u.id}
                    onClick={() => setSelectedUser(u)}
                    className={`w-full text-left px-4 py-3 border-b border-border/30 transition-all relative
                      ${isActive ? "bg-primary/8 border-l-2 border-l-primary" : "hover:bg-muted/50 border-l-2 border-l-transparent"}`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`h-2.5 w-2.5 rounded-full flex-shrink-0 ${statusDot(est.estado)}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium truncate">{u.full_name || u.company_name || u.email.split("@")[0]}</span>
                          {u.role === "admin" && (
                            <Badge variant="outline" className="text-[10px] border-primary/30 text-primary px-1.5 py-0">Admin</Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border bg-card text-foreground/80">
                            {TIPO_LABEL[tipo]}
                          </span>
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${statusColor(est.estado)}`}>
                            {est.etiqueta}
                          </span>
                          {u.plan.tier !== "free" && (
                            <span className="text-[10px] font-semibold text-success">{planLabel(u.plan.tier)}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
              {filtered.length === 0 && (
                <div className="p-8 text-center text-sm text-muted-foreground">No hay usuarios</div>
              )}
            </ScrollArea>
          </div>

          {/* Detail pane */}
          <div className="flex-1 flex flex-col min-w-0 bg-card">
            {selectedUser ? (
              <UserDetail key={selectedUser.id} user={selectedUser} onDelete={handleDelete} deleting={deleting} onToggleRole={handleToggleRole} togglingRole={togglingRole} isSelf={selectedUser.id === user?.id} />
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center text-muted-foreground gap-3">
                <div className="h-16 w-16 rounded-full bg-muted/40 flex items-center justify-center">
                  <Users className="h-8 w-8" />
                </div>
                <p className="text-[15px] font-medium">Selecciona un usuario</p>
                <p className="text-xs text-muted-foreground/60">Elige un usuario de la lista para ver sus datos y credenciales</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Usuarios registrados y cuántos clientes tiene cada uno */}
      <UsersAndClients />
    </div>
  );
}

type UserClientRow = {
  user_id: string;
  email: string | null;
  full_name: string | null;
  company_name: string | null;
  created_at: string;
  tier: string;
  status: string;
  extra_slots: number;
  slots: number;
  clients_count: number;
};

/** Tabla "Usuarios y clientes": sale del RPC admin_users_with_client_counts(), que
 *  YA comprueba el rol admin dentro y ordena en el servidor. Si responde
 *  `forbidden` (o cualquier error), la sección simplemente no se muestra. */
function UsersAndClients() {
  const [rows, setRows] = useState<UserClientRow[] | null>(null);
  const [hidden, setHidden] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await (supabase as any).rpc("admin_users_with_client_counts");
    if (error) {
      setHidden(true);
      setLoading(false);
      return;
    }
    setRows((data as UserClientRow[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (hidden) return null;

  return (
    <div className="space-y-3 px-1">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-[19px] font-semibold tracking-[-0.03em] flex items-center gap-2">
            <Building2 className="h-4 w-4 text-primary" /> Usuarios y clientes
          </h2>
          <p className="text-[13px] text-muted-foreground">
            Quién se ha registrado y cuántos clientes ha creado dentro de su cuenta.
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-2" onClick={load} disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Actualizar
        </Button>
      </div>

      {loading && !rows ? (
        <div className="flex items-center justify-center rounded-md border border-border bg-card py-10">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border bg-card shadow-rest">
          <table className="w-full min-w-[720px] border-collapse text-[15px]">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-[13px] font-semibold text-muted-foreground">
                <th scope="col" className="px-4 py-2.5 text-left">Usuario</th>
                <th scope="col" className="px-4 py-2.5 text-left">Plan</th>
                <th scope="col" className="px-4 py-2.5 text-left">Estado</th>
                <th scope="col" className="px-4 py-2.5 text-left">Clientes / plazas</th>
                <th scope="col" className="px-4 py-2.5 text-left">Registro</th>
              </tr>
            </thead>
            <tbody>
              {(rows || []).length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-[13px] text-muted-foreground">
                    No hay usuarios que mostrar.
                  </td>
                </tr>
              )}
              {(rows || []).map((r) => (
                <tr key={r.user_id} className="border-b border-border/60 last:border-b-0">
                  <td className="px-4 py-3">
                    <p className="text-[15px] font-semibold text-foreground">
                      {r.full_name || r.company_name || (r.email || "").split("@")[0] || "Sin nombre"}
                    </p>
                    <p className="text-[13px] text-muted-foreground">{r.email || "Sin email"}</p>
                  </td>
                  <td className="px-4 py-3 text-[15px] capitalize">
                    {r.tier === "free" ? "Gratuito" : PLAN_CONFIG[r.tier as keyof typeof PLAN_CONFIG]?.label || r.tier}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-md border px-2 py-[2px] text-[13px] font-semibold ${
                      r.status === "active" || r.status === "trialing"
                        ? "bg-success/12 text-success border-success/25"
                        : r.status === "past_due"
                          ? "bg-warning/15 text-warning border-warning/30"
                          : "bg-muted text-muted-foreground border-border"
                    }`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-[15px] font-semibold tabular-nums text-violet-600 dark:text-violet-400">
                      {Number(r.clients_count)}
                    </span>
                    <span className="text-[13px] text-muted-foreground"> / {r.slots >= 100000 ? "sin tope" : r.slots}</span>
                    {r.extra_slots > 0 && (
                      <span className="text-[13px] text-muted-foreground"> · {r.extra_slots} extra</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[13px] text-muted-foreground">
                    {r.created_at
                      ? new Date(r.created_at).toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" })
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function UserDetail({ user, onDelete, deleting, onToggleRole, togglingRole, isSelf }: { user: AdminUser; onDelete: (id: string) => void; deleting: boolean; onToggleRole: (userId: string, newRole: string) => void; togglingRole: boolean; isSelf: boolean }) {
  const [verPass, setVerPass] = useState(false);
  const tipo = tipoDeUsuario(user);
  const est = estadoPanel(user);
  const acceso = accesoDe(user);
  const nombre = user.full_name || user.company_name || user.email.split("@")[0];

  return (
    <ScrollArea className="flex-1">
      <div className="p-6 space-y-6">
        {/* User header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-4 min-w-0">
            <div className={`h-14 w-14 flex-shrink-0 rounded-full flex items-center justify-center text-lg font-bold border ${statusColor(est.estado)}`}>
              {(nombre || "?")[0].toUpperCase()}
            </div>
            <div className="min-w-0">
              <h2 className="font-display text-xl font-semibold tracking-[-0.03em] truncate">{nombre}</h2>
              <p className="text-[15px] text-muted-foreground flex items-center gap-1.5">
                <Mail className="h-3.5 w-3.5" /> {user.email}
              </p>
              {user.company_name && (
                <p className="text-[15px] text-muted-foreground flex items-center gap-1.5 mt-0.5">
                  <Building2 className="h-3.5 w-3.5" /> {user.company_name}
                </p>
              )}
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border bg-card">{TIPO_LABEL[tipo]}</span>
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${statusColor(est.estado)}`}>
                  <span className={`h-2 w-2 rounded-full ${statusDot(est.estado)}`} />
                  {est.etiqueta}
                </span>
                {user.role === "admin" && (
                  <Badge className="bg-primary/10 text-primary border-primary/30">Admin</Badge>
                )}
              </div>
            </div>
          </div>

          {!isSelf && (
            <div className="flex gap-2 flex-shrink-0">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                disabled={togglingRole}
                onClick={() => onToggleRole(user.id, user.role === "admin" ? "client" : "admin")}
              >
                <Shield className="h-3.5 w-3.5" />
                {togglingRole ? "Cambiando…" : user.role === "admin" ? "Quitar Admin" : "Hacer Admin"}
              </Button>

              {user.role !== "admin" && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/10">
                      <Trash2 className="h-3.5 w-3.5" /> Eliminar
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>¿Eliminar usuario?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Se eliminará permanentemente a <strong>{user.email}</strong> y todos sus datos. Esta acción no se puede deshacer.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        onClick={() => onDelete(user.id)}
                        disabled={deleting}
                      >
                        {deleting ? "Eliminando…" : "Eliminar"}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          )}
        </div>

        {/* Credenciales */}
        <div className="rounded-lg border p-4 space-y-3">
          <h3 className="text-[10.5px] font-semibold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
            <KeyRound className="h-3.5 w-3.5" /> Credenciales
          </h3>
          <div className="grid grid-cols-[110px_1fr] gap-y-2 text-[15px] items-center">
            <span className="text-muted-foreground">Correo</span>
            <span className="flex items-center gap-2 min-w-0">
              <span className="font-mono truncate">{user.email}</span>
              <button onClick={() => copiar(user.email, "Correo")} className="text-muted-foreground hover:text-primary" title="Copiar correo">
                <Copy className="h-3.5 w-3.5" />
              </button>
            </span>
            <span className="text-muted-foreground">Contraseña</span>
            {user.client_password ? (
              <span className="flex items-center gap-2 min-w-0">
                <span className="font-mono truncate">{verPass ? user.client_password : "••••••••••"}</span>
                <button onClick={() => setVerPass((v) => !v)} className="text-muted-foreground hover:text-primary" title={verPass ? "Ocultar" : "Ver contraseña"}>
                  {verPass ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
                <button onClick={() => copiar(user.client_password!, "Contraseña")} className="text-muted-foreground hover:text-primary" title="Copiar contraseña">
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </span>
            ) : (
              <span className="text-[13px] text-muted-foreground">
                {user.provider && user.provider !== "email"
                  ? `Entra con ${user.provider === "google" ? "Google" : user.provider}: no tiene contraseña propia.`
                  : "La eligió la propia persona al registrarse. Se guarda cifrada, así que nadie (ni tú) puede verla."}
              </span>
            )}
            <span className="text-muted-foreground">Acceso</span>
            <span className="text-[13px] text-muted-foreground">
              {user.email_confirmed ? "Correo confirmado" : "Correo sin confirmar"} · último acceso {user.last_sign_in_at ? fecha(user.last_sign_in_at) : "nunca"}
            </span>
            {user.contact_email && user.contact_email.toLowerCase() !== user.email.toLowerCase() && (
              <>
                <span className="text-muted-foreground">Contacto</span>
                <span className="font-mono text-[13px] truncate">{user.contact_email}</span>
              </>
            )}
          </div>
        </div>

        {/* Info cards */}
        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-lg border p-4 space-y-2">
            <h3 className="text-[10.5px] font-semibold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" /> Registro
            </h3>
            <p className="text-[15px]">{fecha(user.created_at, true)}</p>
            {acceso.kind === "trialing" && (
              <p className="text-[13px] text-warning">Prueba hasta el {fecha(acceso.trialEnd)}</p>
            )}
            {acceso.kind === "expired" && (
              <p className="text-[13px] text-destructive">La prueba acabó el {fecha(acceso.trialEnd)}: no puede usar el panel hasta que pague</p>
            )}
          </div>

          <div className={`rounded-lg border p-4 space-y-2 ${est.estado === "pago" ? "border-emerald-500/30 bg-emerald-500/5" : ""}`}>
            <h3 className="text-[10.5px] font-semibold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
              <CreditCard className="h-3.5 w-3.5" /> Plan
            </h3>
            {est.estado === "pago" ? (
              <div className="space-y-1">
                <p className="text-[15px] font-semibold text-success">{planLabel(user.plan.tier)} · {est.etiqueta}</p>
                {user.plan.current_period_end && (
                  <p className="text-[13px] text-muted-foreground">Renueva el {fecha(user.plan.current_period_end)}</p>
                )}
              </div>
            ) : (
              <p className="text-[15px] text-muted-foreground">
                {est.estado === "gratis" ? "Sin plan de pago (acceso gratuito)" : "Sin plan de pago"}
              </p>
            )}
          </div>

          <div className="rounded-lg border p-4 space-y-2 col-span-2">
            <h3 className="text-[10.5px] font-semibold text-muted-foreground uppercase tracking-widest">Uso</h3>
            <p className="text-[15px]">
              {user.leads_count.toLocaleString("es-ES")} leads · {user.accounts_count.toLocaleString("es-ES")} cuentas de correo · {user.clients_count} clientes creados
            </p>
          </div>
        </div>
      </div>
    </ScrollArea>
  );
}
