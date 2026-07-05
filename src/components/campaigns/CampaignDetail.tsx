import { useState, useEffect, useRef, lazy, Suspense } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarChart3, Users, ListChecks, Clock, Settings, Mail, Heart, Ban } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
// Each tab is loaded only when opened — Analytics pulls recharts, others are
// heavy too, so eager-importing all of them made every campaign open slow.
const CampaignAnalytics = lazy(() => import("./CampaignAnalytics"));
const CampaignLeads = lazy(() => import("./CampaignLeads"));
const CampaignSequences = lazy(() => import("./CampaignSequences"));
const CampaignSchedule = lazy(() => import("./CampaignSchedule"));
const CampaignOptions = lazy(() => import("./CampaignOptions"));
const CampaignSentLog = lazy(() => import("./CampaignSentLog"));
const CampaignCRM = lazy(() => import("./CampaignCRM"));
const CampaignUnsubscribes = lazy(() => import("./CampaignUnsubscribes"));

interface Props { campaignId: string; }

export default function CampaignDetail({ campaignId }: Props) {
  const [crmEnabled, setCrmEnabled] = useState(false);
  const [activeTab, setActiveTab] = useState("sequences");
  const optionsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    supabase.from("campaigns").select("crm_enabled").eq("id", campaignId).single().then(({ data }) => {
      if (data) setCrmEnabled((data as any).crm_enabled ?? false);
    });
  }, [campaignId]);

  useEffect(() => {
    setActiveTab("sequences");
  }, [campaignId]);

  useEffect(() => {
    if (activeTab !== "options") return;
    requestAnimationFrame(() => {
      optionsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [activeTab]);

  const toggleCrm = async (val: boolean) => {
    setCrmEnabled(val);
    await supabase.from("campaigns").update({ crm_enabled: val } as any).eq("id", campaignId);
    toast.success(val ? "CRM activado" : "CRM desactivado");
  };

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
      <TabsList className="w-full justify-start flex-wrap h-auto gap-1 p-1">
        <TabsTrigger value="analytics" className="gap-1 text-xs"><BarChart3 className="h-3.5 w-3.5" /> Analytics</TabsTrigger>
        <TabsTrigger value="leads" className="gap-1 text-xs"><Users className="h-3.5 w-3.5" /> Leads</TabsTrigger>
        <TabsTrigger value="sequences" className="gap-1 text-xs"><ListChecks className="h-3.5 w-3.5" /> Sequences</TabsTrigger>
        <TabsTrigger value="sent" className="gap-1 text-xs"><Mail className="h-3.5 w-3.5" /> Enviados</TabsTrigger>
        <TabsTrigger value="schedule" className="gap-1 text-xs"><Clock className="h-3.5 w-3.5" /> Schedule</TabsTrigger>
        <TabsTrigger value="options" className="gap-1 text-xs"><Settings className="h-3.5 w-3.5" /> Options</TabsTrigger>
        <TabsTrigger value="unsubscribes" className="gap-1 text-xs"><Ban className="h-3.5 w-3.5" /> Bajas</TabsTrigger>
        {crmEnabled && (
          <TabsTrigger value="crm" className="gap-1 text-xs"><Heart className="h-3.5 w-3.5" /> CRM</TabsTrigger>
        )}
      </TabsList>

      <div className="flex items-center gap-2 mt-3">
        <Switch checked={crmEnabled} onCheckedChange={toggleCrm} />
        <span className="text-xs text-muted-foreground">Activar CRM (leads interesados)</span>
      </div>

      <Suspense fallback={<div className="mt-4 py-12 text-center text-sm text-muted-foreground">Cargando…</div>}>
        <TabsContent value="analytics" className="mt-4"><CampaignAnalytics campaignId={campaignId} /></TabsContent>
        <TabsContent value="leads" className="mt-4"><CampaignLeads campaignId={campaignId} /></TabsContent>
        <TabsContent value="sequences" className="mt-4"><CampaignSequences campaignId={campaignId} /></TabsContent>
        <TabsContent value="sent" className="mt-4"><CampaignSentLog campaignId={campaignId} /></TabsContent>
        <TabsContent value="schedule" className="mt-4"><CampaignSchedule campaignId={campaignId} /></TabsContent>
        <TabsContent value="options" className="mt-4">
          <div ref={optionsRef}>
            <CampaignOptions campaignId={campaignId} />
          </div>
        </TabsContent>
        <TabsContent value="unsubscribes" className="mt-4"><CampaignUnsubscribes campaignId={campaignId} /></TabsContent>
        {crmEnabled && (
          <TabsContent value="crm" className="mt-4"><CampaignCRM campaignId={campaignId} /></TabsContent>
        )}
      </Suspense>
    </Tabs>
  );
}
