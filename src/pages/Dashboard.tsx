import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Send, MessageCircle, Users, Mail, BarChart3, UserCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { cacheGet, cacheSet } from "@/lib/instant-cache";
import TodayMessages from "@/components/dashboard/TodayMessages";

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  // Instant re-entry: paint cached stats immediately, refresh in background.
  const [stats, setStats] = useState(() => cacheGet<any>("dash:stats") || { sent: 0, contacted: 0, replied: 0, leads: 0, accounts: 0 });
  const [campaigns, setCampaigns] = useState<any[]>(() => cacheGet<any[]>("dash:campaigns") || []);
  const [loading, setLoading] = useState(() => !cacheGet<any>("dash:stats"));

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      // Enviados/contactados/respuestas salen de la MISMA RPC exacta que Estadísticas
      // (cuenta server-side, sin el tope de 1000 filas, respuestas del inbox). Así el
      // Dashboard y Estadísticas siempre cuadran. try/finally → un fallo/lentitud nunca
      // deja la pantalla en "cargando" (peor caso: enseña lo cacheado o ceros).
      try {
        const [statsRes, accountsRes, leadsRes, campaignsRes] = await Promise.all([
          (supabase as any).rpc("user_email_stats"),
          supabase.from("email_accounts").select("id", { count: "exact", head: true }).eq("user_id", user.id),
          supabase.from("leads").select("id", { count: "exact", head: true }).eq("user_id", user.id),
          supabase.from("campaigns").select("*, campaign_leads(count), sent_emails(count)").eq("user_id", user.id).order("created_at", { ascending: false }).limit(5),
        ]);

        const s = (statsRes?.data || {}) as { sent?: number; contacted?: number; replied?: number };
        const newStats = {
          sent: Number(s.sent || 0),
          contacted: Number(s.contacted || 0),
          replied: Number(s.replied || 0),
          leads: leadsRes.count || 0,
          accounts: accountsRes.count || 0,
        };
        setStats(newStats);
        setCampaigns(campaignsRes.data || []);
        cacheSet("dash:stats", newStats);
        cacheSet("dash:campaigns", campaignsRes.data || []);
      } catch {
        /* keep cached view — never hang the spinner */
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [user]);

  // Tasa REAL = respuestas ÷ LEADS contactados (personas), no ÷ correos enviados.
  const responseRate = stats.contacted > 0 ? ((stats.replied / stats.contacted) * 100).toFixed(1) : "0";

  const statCards = [
    { label: "Correos enviados", value: stats.sent.toLocaleString(), icon: Send, color: "text-primary" },
    { label: "Leads contactados", value: stats.contacted.toLocaleString(), icon: UserCheck, color: "text-info" },
    { label: "Tasa de respuesta", value: `${responseRate}%`, icon: MessageCircle, color: "text-success" },
    { label: "Leads totales", value: stats.leads.toLocaleString(), icon: Users, color: "text-info" },
    { label: "Cuentas activas", value: stats.accounts.toLocaleString(), icon: Mail, color: "text-warning" },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Resumen de tu actividad de email marketing</p>
        </div>
        <Button onClick={() => navigate("/metrics")} className="gap-2">
          <BarChart3 className="h-4 w-4" /> Métricas
        </Button>
      </div>

      <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
        {statCards.map((stat, i) => (
          <Card key={i}>
            <CardContent className="p-4 sm:p-6">
              <div className={`flex h-8 w-8 sm:h-10 sm:w-10 items-center justify-center rounded-lg bg-primary/10 ${stat.color}`}>
                <stat.icon className="h-4 w-4 sm:h-5 sm:w-5" />
              </div>
              <p className="mt-2 sm:mt-4 font-display text-lg sm:text-2xl font-bold">{stat.value}</p>
              <p className="text-[10px] sm:text-xs text-muted-foreground">{stat.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Today Messages */}
        <TodayMessages />

        {/* Campaigns */}
        <Card>
          <CardHeader>
            <CardTitle className="font-display text-base">Campañas recientes</CardTitle>
          </CardHeader>
          <CardContent>
            {campaigns.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No tienes campañas aún. ¡Crea tu primera campaña!
              </p>
            ) : (
              <div className="space-y-3">
                {campaigns.map((c: any) => (
                  <div key={c.id} className="flex items-center justify-between rounded-lg border p-4">
                    <div>
                      <p className="font-medium text-sm">{c.name}</p>
                      <span className={`text-xs font-medium ${
                        c.status === "active" ? "text-success" : c.status === "paused" ? "text-warning" : "text-muted-foreground"
                      }`}>
                        {c.status === "active" ? "Activa" : c.status === "paused" ? "Pausada" : c.status === "draft" ? "Borrador" : c.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
