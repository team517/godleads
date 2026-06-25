import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Users, Mail, Calendar } from "lucide-react";

interface Props { campaignId: string; }

export default function CampaignCRM({ campaignId }: Props) {
  const { user } = useAuth();
  const [leads, setLeads] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      if (!user) return;
      // Get inbox messages for this campaign that have "Interesado" label
      const { data: messages } = await supabase
        .from("inbox_messages")
        .select("id, from_email, from_name, subject, received_at, labels, lead_id")
        .eq("campaign_id", campaignId)
        .eq("user_id", user.id)
        .contains("labels", ["Interesado"])
        .order("received_at", { ascending: false });

      if (!messages?.length) {
        setLeads([]);
        setLoading(false);
        return;
      }

      // Get lead details for enrichment
      const leadIds = messages.map(m => m.lead_id).filter(Boolean);
      let leadsMap: Record<string, any> = {};
      if (leadIds.length) {
        const { data: leadsData } = await supabase
          .from("leads")
          .select("id, email, custom_fields")
          .in("id", leadIds);
        (leadsData || []).forEach(l => { leadsMap[l.id] = l; });
      }

      const enriched = messages.map(m => {
        const lead = m.lead_id ? leadsMap[m.lead_id] : null;
        const cf = lead?.custom_fields || {};
        return {
          id: m.id,
          email: m.from_email,
          name: m.from_name || cf.first_name ? `${cf.first_name || ""} ${cf.last_name || ""}`.trim() : m.from_email,
          company: cf.company_name || cf.company || "",
          subject: m.subject || "(sin asunto)",
          received_at: m.received_at,
          labels: m.labels || [],
        };
      });

      setLeads(enriched);
      setLoading(false);
    };
    load();
  }, [campaignId, user]);

  if (loading) return <div className="flex justify-center py-8"><div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>;

  if (!leads.length) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <Users className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <h3 className="font-semibold mb-1">Sin leads interesados aún</h3>
          <p className="text-sm text-muted-foreground">Los leads que respondan con interés aparecerán aquí automáticamente.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{leads.length} lead{leads.length !== 1 ? "s" : ""} interesado{leads.length !== 1 ? "s" : ""}</p>
      </div>
      <div className="space-y-2">
        {leads.map(lead => (
          <div key={lead.id} className="flex items-center gap-3 rounded-lg border p-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary font-semibold text-sm shrink-0">
              {(lead.name || lead.email)[0]?.toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-sm truncate">{lead.name}</span>
                {lead.company && <Badge variant="outline" className="text-[10px]">{lead.company}</Badge>}
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                <span className="flex items-center gap-1 truncate"><Mail className="h-3 w-3" />{lead.email}</span>
                <span className="flex items-center gap-1 shrink-0"><Calendar className="h-3 w-3" />{new Date(lead.received_at).toLocaleDateString()}</span>
              </div>
              <p className="text-xs text-muted-foreground truncate mt-0.5">{lead.subject}</p>
            </div>
            <Badge variant="default" className="shrink-0 text-[10px]">Interesado</Badge>
          </div>
        ))}
      </div>
    </div>
  );
}
