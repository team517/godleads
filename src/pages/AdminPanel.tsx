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
import { Search, Users, Trash2, RefreshCw, Mail, Building2, Calendar, CreditCard, Shield, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { PLAN_CONFIG } from "@/contexts/SubscriptionContext";

interface AdminUser {
  id: string;
  email: string;
  created_at: string;
  full_name: string | null;
  company_name: string | null;
  role: string;
  trial_started_at: string | null;
  leads_count: number;
  accounts_count: number;
  stripe: {
    subscribed: boolean;
    product_id: string | null;
    subscription_end: string | null;
  };
}

function getTrialInfo(trialStartedAt: string | null, subscribed: boolean) {
  if (subscribed) return { status: "paid" as const, daysLeft: null, label: "Suscrito" };
  if (!trialStartedAt) return { status: "unknown" as const, daysLeft: null, label: "Sin trial" };

  const start = new Date(trialStartedAt);
  const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
  const now = new Date();
  const daysLeft = Math.min(7, Math.max(0, Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))));

  if (daysLeft > 3) return { status: "active" as const, daysLeft, label: `Día ${7 - daysLeft + 1} de 7` };
  if (daysLeft > 0) return { status: "warning" as const, daysLeft, label: `${daysLeft} días restantes` };
  return { status: "expired" as const, daysLeft: 0, label: "Trial expirado" };
}

function getPlanName(productId: string | null): string {
  if (!productId) return "Free";
  for (const [tier, config] of Object.entries(PLAN_CONFIG)) {
    if ((config.productIds as readonly string[]).includes(productId)) return config.label;
  }
  return "Desconocido";
}

function statusColor(trialStatus: string): string {
  switch (trialStatus) {
    case "paid": return "bg-emerald-500/10 text-emerald-700 border-emerald-500/30";
    case "active": return "bg-emerald-500/10 text-emerald-700 border-emerald-500/30";
    case "warning": return "bg-amber-500/10 text-amber-700 border-amber-500/30";
    case "expired": return "bg-red-500/10 text-red-700 border-red-500/30";
    default: return "bg-muted text-muted-foreground border-border";
  }
}

function statusDot(trialStatus: string): string {
  switch (trialStatus) {
    case "paid": return "bg-emerald-500";
    case "active": return "bg-emerald-500";
    case "warning": return "bg-amber-500";
    case "expired": return "bg-red-500";
    default: return "bg-muted-foreground";
  }
}

export default function AdminPanel() {
  const { user } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
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
        setUsers(result.users || []);
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
        setSelectedUser(prev => prev ? { ...prev, role: newRole } : null);
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

  const filtered = users.filter(u =>
    !search ||
    u.email?.toLowerCase().includes(search.toLowerCase()) ||
    u.full_name?.toLowerCase().includes(search.toLowerCase()) ||
    u.company_name?.toLowerCase().includes(search.toLowerCase())
  );

  const stats = {
    total: users.length,
    paid: users.filter(u => u.stripe.subscribed).length,
    trial: users.filter(u => {
      const info = getTrialInfo(u.trial_started_at, u.stripe.subscribed);
      return info.status === "active" || info.status === "warning";
    }).length,
    expired: users.filter(u => {
      const info = getTrialInfo(u.trial_started_at, u.stripe.subscribed);
      return info.status === "expired";
    }).length,
  };

  return (
    <div className="flex flex-col h-[calc(100vh-80px)]">
      {/* Header */}
      <div className="flex items-center justify-between px-1 pb-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight flex items-center gap-2">
            <Shield className="h-6 w-6 text-primary" /> Admin Panel
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {stats.total} usuarios · {stats.paid} pagando · {stats.trial} en trial · {stats.expired} expirados
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-2" onClick={loadUsers} disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Actualizar
        </Button>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-4 gap-3 px-1 pb-4">
        {[
          { label: "Total", value: stats.total, color: "text-foreground", bg: "bg-muted" },
          { label: "Pagando", value: stats.paid, color: "text-emerald-700", bg: "bg-emerald-500/10" },
          { label: "En Trial", value: stats.trial, color: "text-amber-700", bg: "bg-amber-500/10" },
          { label: "Expirados", value: stats.expired, color: "text-red-700", bg: "bg-red-500/10" },
        ].map(s => (
          <div key={s.label} className={`rounded-lg border p-3 ${s.bg}`}>
            <p className="text-xs text-muted-foreground">{s.label}</p>
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : (
        <div className="flex flex-1 gap-0 rounded-lg border bg-card overflow-hidden min-h-0">
          {/* User list */}
          <div className="w-[400px] flex-shrink-0 flex flex-col border-r bg-muted/20">
            <div className="p-3 border-b bg-card">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Buscar usuario…"
                  className="pl-9 h-8 text-sm bg-muted/40 border-0 focus-visible:ring-1"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
            </div>
            <ScrollArea className="flex-1">
              {filtered.map(u => {
                const trialInfo = getTrialInfo(u.trial_started_at, u.stripe.subscribed);
                const isActive = selectedUser?.id === u.id;
                return (
                  <button
                    key={u.id}
                    onClick={() => setSelectedUser(u)}
                    className={`w-full text-left px-4 py-3 border-b border-border/30 transition-all relative
                      ${isActive ? "bg-primary/8 border-l-2 border-l-primary" : "hover:bg-muted/50 border-l-2 border-l-transparent"}`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`h-2.5 w-2.5 rounded-full flex-shrink-0 ${statusDot(trialInfo.status)}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium truncate">{u.full_name || u.email.split("@")[0]}</span>
                          {u.role === "admin" && (
                            <Badge variant="outline" className="text-[10px] border-primary/30 text-primary px-1.5 py-0">Admin</Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${statusColor(trialInfo.status)}`}>
                            {trialInfo.label}
                          </span>
                          {u.stripe.subscribed && (
                            <span className="text-[10px] text-emerald-600 font-medium">
                              {getPlanName(u.stripe.product_id)}
                            </span>
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
              <UserDetail user={selectedUser} onDelete={handleDelete} deleting={deleting} onToggleRole={handleToggleRole} togglingRole={togglingRole} />
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center text-muted-foreground gap-3">
                <div className="h-16 w-16 rounded-full bg-muted/40 flex items-center justify-center">
                  <Users className="h-8 w-8" />
                </div>
                <p className="text-sm font-medium">Selecciona un usuario</p>
                <p className="text-xs text-muted-foreground/60">Elige un usuario de la lista para ver sus detalles</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function UserDetail({ user, onDelete, deleting, onToggleRole, togglingRole }: { user: AdminUser; onDelete: (id: string) => void; deleting: boolean; onToggleRole: (userId: string, newRole: string) => void; togglingRole: boolean }) {
  const trialInfo = getTrialInfo(user.trial_started_at, user.stripe.subscribed);

  const trialStart = user.trial_started_at ? new Date(user.trial_started_at) : null;
  const trialEnd = trialStart ? new Date(trialStart.getTime() + 7 * 24 * 60 * 60 * 1000) : null;

  return (
    <ScrollArea className="flex-1">
      <div className="p-6 space-y-6">
        {/* User header */}
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-4">
            <div className={`h-14 w-14 rounded-full flex items-center justify-center text-lg font-bold ${statusColor(trialInfo.status)}`}>
              {(user.full_name || user.email)[0].toUpperCase()}
            </div>
            <div>
              <h2 className="text-xl font-bold">{user.full_name || user.email.split("@")[0]}</h2>
              <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                <Mail className="h-3.5 w-3.5" /> {user.email}
              </p>
              {user.company_name && (
                <p className="text-sm text-muted-foreground flex items-center gap-1.5 mt-0.5">
                  <Building2 className="h-3.5 w-3.5" /> {user.company_name}
                </p>
              )}
              <div className="flex items-center gap-2 mt-2">
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${statusColor(trialInfo.status)}`}>
                  <span className={`h-2 w-2 rounded-full ${statusDot(trialInfo.status)}`} />
                  {trialInfo.label}
                </span>
                {user.role === "admin" && (
                  <Badge className="bg-primary/10 text-primary border-primary/30">Admin</Badge>
                )}
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            {/* Toggle role button */}
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

            {/* Delete button */}
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
        </div>

        {/* Info cards */}
        <div className="grid grid-cols-2 gap-4">
          {/* Registration */}
          <div className="rounded-lg border p-4 space-y-2">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" /> Registro
            </h3>
            <p className="text-sm">
              {new Date(user.created_at).toLocaleDateString("es", { day: "numeric", month: "long", year: "numeric" })}
            </p>
          </div>

          {/* Trial */}
          <div className={`rounded-lg border p-4 space-y-2 ${trialInfo.status === "expired" ? "border-red-500/30 bg-red-500/5" : trialInfo.status === "warning" ? "border-amber-500/30 bg-amber-500/5" : ""}`}>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Trial</h3>
            {trialStart ? (
              <div className="space-y-1">
                <p className="text-sm">Inicio: {trialStart.toLocaleDateString("es", { day: "numeric", month: "short" })}</p>
                <p className="text-sm">Fin: {trialEnd?.toLocaleDateString("es", { day: "numeric", month: "short" })}</p>
                <p className={`text-sm font-semibold ${trialInfo.status === "expired" ? "text-red-600" : trialInfo.status === "warning" ? "text-amber-600" : "text-emerald-600"}`}>
                  {trialInfo.label}
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Sin trial</p>
            )}
          </div>

          {/* Payment */}
          <div className={`rounded-lg border p-4 space-y-2 ${user.stripe.subscribed ? "border-emerald-500/30 bg-emerald-500/5" : "border-red-500/30 bg-red-500/5"}`}>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <CreditCard className="h-3.5 w-3.5" /> Pago
            </h3>
            {user.stripe.subscribed ? (
              <div className="space-y-1">
                <p className="text-sm font-semibold text-emerald-600">✓ Suscripción activa</p>
                <p className="text-sm">Plan: {getPlanName(user.stripe.product_id)}</p>
                {user.stripe.subscription_end && (
                  <p className="text-sm text-muted-foreground">
                    Renueva: {new Date(user.stripe.subscription_end).toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" })}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm font-semibold text-red-600">✗ Sin suscripción</p>
            )}
          </div>

          {/* Usage */}
          <div className="rounded-lg border p-4 space-y-2">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Uso</h3>
            <div className="space-y-1">
              <p className="text-sm">{user.leads_count} leads</p>
              <p className="text-sm">{user.accounts_count} cuentas email</p>
            </div>
          </div>
        </div>
      </div>
    </ScrollArea>
  );
}
