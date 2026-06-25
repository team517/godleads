import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export default function Stats() {
  const { user } = useAuth();
  const [stats, setStats] = useState({ sent: 0, delivered: 0, opened: 0, replied: 0, bounced: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      const { data } = await supabase.from("sent_emails").select("status, sent_at, opened_at, replied_at, bounced_at").eq("user_id", user.id);
      const emails = data || [];
      setStats({
        sent: emails.length,
        delivered: emails.filter(e => e.status === "sent" || e.sent_at).length,
        opened: emails.filter(e => e.opened_at).length,
        replied: emails.filter(e => e.replied_at).length,
        bounced: emails.filter(e => e.bounced_at || e.status === "bounced").length,
      });
      setLoading(false);
    };
    load();
  }, [user]);

  const pieData = [
    { name: "Entregados", value: stats.delivered || 1, color: "hsl(217, 91%, 60%)" },
    { name: "Abiertos", value: stats.opened, color: "hsl(199, 89%, 48%)" },
    { name: "Respondidos", value: stats.replied, color: "hsl(142, 76%, 36%)" },
    { name: "Rebotados", value: stats.bounced, color: "hsl(0, 84%, 60%)" },
  ];

  const overviewStats = [
    { label: "Total enviados", value: stats.sent.toLocaleString() },
    { label: "Tasa de entrega", value: stats.sent > 0 ? `${((stats.delivered / stats.sent) * 100).toFixed(1)}%` : "0%" },
    { label: "Tasa de apertura", value: stats.sent > 0 ? `${((stats.opened / stats.sent) * 100).toFixed(1)}%` : "0%" },
    { label: "Tasa de respuesta", value: stats.sent > 0 ? `${((stats.replied / stats.sent) * 100).toFixed(1)}%` : "0%" },
    { label: "Rebotes", value: stats.sent > 0 ? `${((stats.bounced / stats.sent) * 100).toFixed(1)}%` : "0%" },
  ];

  if (loading) return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold">Estadísticas</h1>
        <p className="text-sm text-muted-foreground">Análisis detallado de rendimiento</p>
      </div>

      <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-5">
        {overviewStats.map((stat, i) => (
          <Card key={i}>
            <CardContent className="p-4 text-center">
              <p className="font-display text-xl font-bold">{stat.value}</p>
              <p className="text-xs text-muted-foreground mt-1">{stat.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {stats.sent === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <p className="text-sm text-muted-foreground">Aún no hay datos de envío. Las estadísticas aparecerán cuando empieces a enviar campañas.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader><CardTitle className="font-display text-base">Distribución</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={60} outerRadius={90} dataKey="value" paddingAngle={4}>
                  {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
            <div className="mt-2 space-y-2">
              {pieData.map((item, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <div className="h-3 w-3 rounded-full" style={{ backgroundColor: item.color }} />
                    <span className="text-muted-foreground">{item.name}</span>
                  </div>
                  <span className="font-medium">{item.value}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
