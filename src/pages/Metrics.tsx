import { useEffect, useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, BarChart3, Mail, MessageCircle, TrendingUp, Users, RefreshCw } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, PieChart, Pie, Cell, Legend,
} from "recharts";
import { format, subDays, parseISO, startOfDay, eachDayOfInterval } from "date-fns";
import { es } from "date-fns/locale";

type RangeKey = "7d" | "14d" | "30d" | "90d" | "all";

export default function Metrics() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [emails, setEmails] = useState<any[]>([]);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [selectedCampaign, setSelectedCampaign] = useState<string>("all");
  const [range, setRange] = useState<RangeKey>("30d");
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    if (!user) return;
    setLoading(true);

    // Fetch all sent_emails (paginate if needed)
    let allEmails: any[] = [];
    let from = 0;
    const PAGE = 1000;
    while (true) {
      const { data } = await supabase
        .from("sent_emails")
        .select("id, campaign_id, to_email, sent_at, replied_at, bounced_at, opened_at, status, subject")
        .eq("user_id", user.id)
        .range(from, from + PAGE - 1);
      if (!data || data.length === 0) break;
      allEmails = allEmails.concat(data);
      if (data.length < PAGE) break;
      from += PAGE;
    }

    const { data: camps } = await supabase
      .from("campaigns")
      .select("id, name")
      .eq("user_id", user.id)
      .order("name");

    setEmails(allEmails);
    setCampaigns(camps || []);
    setLoading(false);
  };

  useEffect(() => { loadData(); }, [user]);

  // Filter by campaign
  const filteredByCampaign = useMemo(() => {
    if (selectedCampaign === "all") return emails;
    return emails.filter(e => e.campaign_id === selectedCampaign);
  }, [emails, selectedCampaign]);

  // Filter by date range
  const filtered = useMemo(() => {
    if (range === "all") return filteredByCampaign;
    const days = range === "7d" ? 7 : range === "14d" ? 14 : range === "30d" ? 30 : 90;
    const cutoff = subDays(new Date(), days);
    return filteredByCampaign.filter(e => {
      const d = e.sent_at ? new Date(e.sent_at) : null;
      return d && d >= cutoff;
    });
  }, [filteredByCampaign, range]);

  // Stats
  const totalSent = filtered.length;
  const totalReplied = filtered.filter(e => e.replied_at).length;
  const totalBounced = filtered.filter(e => e.bounced_at || e.status === "bounced").length;
  const totalOpened = filtered.filter(e => e.opened_at).length;
  const noReply = totalSent - totalReplied;
  const replyRate = totalSent > 0 ? ((totalReplied / totalSent) * 100).toFixed(1) : "0";
  const openRate = totalSent > 0 ? ((totalOpened / totalSent) * 100).toFixed(1) : "0";
  const bounceRate = totalSent > 0 ? ((totalBounced / totalSent) * 100).toFixed(1) : "0";

  // Daily chart data
  const dailyData = useMemo(() => {
    const days = range === "7d" ? 7 : range === "14d" ? 14 : range === "30d" ? 30 : range === "90d" ? 90 : 60;
    const start = subDays(new Date(), days);
    const interval = eachDayOfInterval({ start, end: new Date() });

    return interval.map(day => {
      const dayStr = format(day, "yyyy-MM-dd");
      const dayEmails = filtered.filter(e => {
        const d = e.sent_at ? format(new Date(e.sent_at), "yyyy-MM-dd") : null;
        return d === dayStr;
      });
      return {
        date: format(day, "dd MMM", { locale: es }),
        enviados: dayEmails.length,
        respondidos: dayEmails.filter(e => e.replied_at).length,
        rebotados: dayEmails.filter(e => e.bounced_at || e.status === "bounced").length,
      };
    });
  }, [filtered, range]);

  // Per-campaign breakdown
  const campaignBreakdown = useMemo(() => {
    const map = new Map<string, { name: string; sent: number; replied: number; rate: string }>();
    for (const e of filtered) {
      const cId = e.campaign_id || "sin-campaña";
      if (!map.has(cId)) {
        const camp = campaigns.find(c => c.id === cId);
        map.set(cId, { name: camp?.name || "Sin campaña", sent: 0, replied: 0, rate: "0" });
      }
      const entry = map.get(cId)!;
      entry.sent++;
      if (e.replied_at) entry.replied++;
    }
    return Array.from(map.values()).map(v => ({
      ...v,
      rate: v.sent > 0 ? ((v.replied / v.sent) * 100).toFixed(1) : "0",
    })).sort((a, b) => b.sent - a.sent);
  }, [filtered, campaigns]);

  // Who replied list
  const repliedList = useMemo(() => {
    return filtered
      .filter(e => e.replied_at)
      .sort((a, b) => new Date(b.replied_at).getTime() - new Date(a.replied_at).getTime())
      .slice(0, 50);
  }, [filtered]);

  // Pie data
  const pieData = [
    { name: "Respondidos", value: totalReplied, color: "hsl(142, 76%, 36%)" },
    { name: "Sin respuesta", value: noReply, color: "hsl(220, 14%, 70%)" },
    { name: "Rebotados", value: totalBounced, color: "hsl(0, 84%, 60%)" },
  ].filter(d => d.value > 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/dashboard")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="font-display text-2xl font-bold flex items-center gap-2">
              <BarChart3 className="h-6 w-6 text-primary" /> Métricas
            </h1>
            <p className="text-sm text-muted-foreground">Análisis detallado de rendimiento</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={selectedCampaign} onValueChange={setSelectedCampaign}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Campaña" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas las campañas</SelectItem>
              {campaigns.map(c => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex rounded-lg border overflow-hidden">
            {(["7d", "14d", "30d", "90d", "all"] as RangeKey[]).map(r => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  range === r ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                }`}
              >
                {r === "all" ? "Todo" : r}
              </button>
            ))}
          </div>
          <Button variant="outline" size="icon" onClick={loadData}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
        {[
          { label: "Enviados", value: totalSent.toLocaleString(), icon: Mail, color: "text-primary" },
          { label: "Respondidos", value: totalReplied.toLocaleString(), icon: MessageCircle, color: "text-green-500" },
          { label: "Sin respuesta", value: noReply.toLocaleString(), icon: Users, color: "text-muted-foreground" },
          { label: "Tasa respuesta", value: `${replyRate}%`, icon: TrendingUp, color: "text-green-500" },
          { label: "Rebotes", value: `${bounceRate}%`, icon: Mail, color: "text-destructive" },
        ].map((s, i) => (
          <Card key={i}>
            <CardContent className="p-4">
              <div className={`flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 ${s.color}`}>
                <s.icon className="h-4 w-4" />
              </div>
              <p className="mt-2 font-display text-xl font-bold">{s.value}</p>
              <p className="text-[10px] text-muted-foreground">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Charts row */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Area chart */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="font-display text-base">Actividad diaria</CardTitle>
          </CardHeader>
          <CardContent>
            {totalSent === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-12">Sin datos de envío en este periodo.</p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={dailyData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} className="text-muted-foreground" />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Area type="monotone" dataKey="enviados" stroke="hsl(217, 91%, 60%)" fill="hsl(217, 91%, 60%)" fillOpacity={0.15} strokeWidth={2} />
                  <Area type="monotone" dataKey="respondidos" stroke="hsl(142, 76%, 36%)" fill="hsl(142, 76%, 36%)" fillOpacity={0.15} strokeWidth={2} />
                  <Area type="monotone" dataKey="rebotados" stroke="hsl(0, 84%, 60%)" fill="hsl(0, 84%, 60%)" fillOpacity={0.1} strokeWidth={1.5} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Pie chart */}
        <Card>
          <CardHeader>
            <CardTitle className="font-display text-base">Distribución</CardTitle>
          </CardHeader>
          <CardContent>
            {totalSent === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-12">Sin datos.</p>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" paddingAngle={3}>
                      {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
                <div className="mt-2 space-y-1.5">
                  {pieData.map((item, i) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                        <span className="text-muted-foreground">{item.name}</span>
                      </div>
                      <span className="font-medium">{item.value}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Campaign breakdown bar chart */}
      {campaignBreakdown.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="font-display text-base">Rendimiento por campaña</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={Math.max(200, campaignBreakdown.length * 40)}>
              <BarChart data={campaignBreakdown} layout="vertical" margin={{ left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis type="number" tick={{ fontSize: 10 }} />
                <YAxis dataKey="name" type="category" width={150} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="sent" name="Enviados" fill="hsl(217, 91%, 60%)" radius={[0, 4, 4, 0]} />
                <Bar dataKey="replied" name="Respondidos" fill="hsl(142, 76%, 36%)" radius={[0, 4, 4, 0]} />
                <Legend />
              </BarChart>
            </ResponsiveContainer>
            {/* Table below */}
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 font-medium">Campaña</th>
                    <th className="py-2 font-medium text-right">Enviados</th>
                    <th className="py-2 font-medium text-right">Respondidos</th>
                    <th className="py-2 font-medium text-right">Tasa</th>
                  </tr>
                </thead>
                <tbody>
                  {campaignBreakdown.map((c, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-2 font-medium">{c.name}</td>
                      <td className="py-2 text-right">{c.sent}</td>
                      <td className="py-2 text-right text-green-600">{c.replied}</td>
                      <td className="py-2 text-right">
                        <Badge variant={parseFloat(c.rate) > 5 ? "default" : "secondary"} className="text-xs">
                          {c.rate}%
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Who replied */}
      <Card>
        <CardHeader>
          <CardTitle className="font-display text-base">
            Quién ha respondido <Badge variant="secondary" className="ml-2">{totalReplied}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {repliedList.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">Aún no hay respuestas en este periodo.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 font-medium">Email</th>
                    <th className="py-2 font-medium">Asunto</th>
                    <th className="py-2 font-medium">Campaña</th>
                    <th className="py-2 font-medium text-right">Respondió</th>
                  </tr>
                </thead>
                <tbody>
                  {repliedList.map((e, i) => {
                    const camp = campaigns.find(c => c.id === e.campaign_id);
                    return (
                      <tr key={i} className="border-b last:border-0">
                        <td className="py-2 font-medium">{e.to_email}</td>
                        <td className="py-2 text-muted-foreground truncate max-w-[200px]">{e.subject || "—"}</td>
                        <td className="py-2 text-muted-foreground">{camp?.name || "—"}</td>
                        <td className="py-2 text-right text-xs text-muted-foreground">
                          {e.replied_at ? format(new Date(e.replied_at), "dd MMM yyyy HH:mm", { locale: es }) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
