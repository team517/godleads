import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CountUp } from "@/components/ui/count-up";
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
  // Merge the cached stats OVER the full default shape. Critical: an OLD cache from a previous
  // build lacks `contacted`, and `stats.contacted.toLocaleString()` on undefined threw a
  // TypeError that blanked the whole app (white screen) right after a redeploy. Spreading the
  // cache last guarantees every field exists.
  const [stats, setStats] = useState(() => ({ sent: 0, contacted: 0, replied: 0, leads: 0, accounts: 0, ...(cacheGet<any>("dash:stats") || {}) }));
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

  // Como las métricas del diseño: etiqueta con icono del color de la cifra y cifra grande.
  const statCards = [
    { label: "Correos enviados", value: stats.sent, icon: Send, color: "text-primary" },
    { label: "Leads contactados", value: stats.contacted, icon: UserCheck, color: "text-info" },
    { label: "Tasa de respuesta", value: Number(responseRate), decimals: 1, suffix: "%", icon: MessageCircle, color: "text-success" },
    { label: "Leads totales", value: stats.leads, icon: Users, color: "text-[hsl(var(--brand-indigo))]" },
    { label: "Cuentas activas", value: stats.accounts, icon: Mail, color: "text-warning" },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="stagger space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-[-0.03em]">Dashboard</h1>
          <p className="text-[15px] text-muted-foreground">Resumen de tu actividad de email marketing</p>
        </div>
      </div>

      <div className="stagger grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
        {statCards.map((stat, i) => (
          <Card key={i} className="lift">
            <CardContent className="p-4 sm:p-5">
              <p className="flex items-center gap-1.5 text-[11.5px] sm:text-[12.5px] font-medium text-muted-foreground">
                <stat.icon className={`h-3.5 w-3.5 shrink-0 ${stat.color}`} strokeWidth={2} /> <span className="truncate">{stat.label}</span>
              </p>
              <p className={`mt-1.5 font-display text-[26px] sm:text-[32px] font-semibold leading-none tracking-[-0.03em] tabular ${stat.color}`}>
                <CountUp value={stat.value} decimals={stat.decimals} suffix={stat.suffix} />
              </p>
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
            <CardTitle className="font-display text-[17px] font-semibold tracking-[-0.02em]">Campañas recientes</CardTitle>
          </CardHeader>
          <CardContent>
            {campaigns.length === 0 ? (
              <p className="text-[15px] text-muted-foreground text-center py-8">
                No tienes campañas aún. ¡Crea tu primera campaña!
              </p>
            ) : (
              <div className="space-y-3">
                {campaigns.map((c: any) => (
                  <div key={c.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 shadow-rest transition-colors hover:border-[#C9BFFA] hover:bg-accent/30">
                    <p className="min-w-0 truncate text-[15px] font-semibold text-foreground">{c.name}</p>
                    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11.5px] font-semibold ${
                      c.status === "active" ? "border-success/25 bg-success/10 text-success" : c.status === "paused" ? "border-warning/30 bg-warning/10 text-warning" : "border-border bg-muted text-muted-foreground"
                    }`}>
                      {c.status === "active" && <span className="live-dot h-1.5 w-1.5 rounded-full bg-[#05D17F]" />}
                      {c.status === "active" ? "Activa" : c.status === "paused" ? "Pausada" : c.status === "draft" ? "Borrador" : c.status}
                    </span>
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
