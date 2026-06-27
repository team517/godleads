import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Ban, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";

export default function CampaignUnsubscribes({ campaignId }: { campaignId: string }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      const { data } = await (supabase as any)
        .from("campaign_leads")
        .select("id, unsubscribed_at, leads(email)")
        .eq("campaign_id", campaignId)
        .eq("status", "unsubscribed")
        .order("unsubscribed_at", { ascending: false });
      if (active) { setRows(data || []); setLoading(false); }
    })();
    return () => { active = false; };
  }, [campaignId]);

  if (loading) {
    return <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-3 flex items-center gap-2">
          <Ban className="h-4 w-4 text-rose-500" />
          <h3 className="font-display text-sm font-semibold">Bajas ({rows.length})</h3>
        </div>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nadie se ha dado de baja todavía.</p>
        ) : (
          <div className="divide-y divide-border/50">
            {rows.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <span className="truncate">{r.leads?.email || "—"}</span>
                <span className="whitespace-nowrap text-xs text-muted-foreground">
                  {r.unsubscribed_at ? format(new Date(r.unsubscribed_at), "d MMM yyyy HH:mm", { locale: es }) : ""}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
