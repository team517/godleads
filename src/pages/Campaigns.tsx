import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Copy, Play, Pause, Trash2, Send, ChevronLeft, Pencil, Check, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import CampaignDetail from "@/components/campaigns/CampaignDetail";
import CampaignReportBar from "@/components/campaigns/CampaignReportBar";
import CampaignMetricsInline from "@/components/campaigns/CampaignMetricsInline";

const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  active: { label: "Active", variant: "default" },
  paused: { label: "Paused", variant: "secondary" },
  draft: { label: "Draft", variant: "outline" },
  completed: { label: "Completed", variant: "secondary" },
};

function EditableCampaignName({ campaign, onSaved }: { campaign: any; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(campaign.name);
  const status = statusConfig[campaign.status] || statusConfig.draft;

  const save = async () => {
    if (!name.trim()) return;
    await supabase.from("campaigns").update({ name: name.trim() }).eq("id", campaign.id);
    toast.success("Nombre actualizado");
    setEditing(false);
    onSaved();
  };

  if (editing) {
    return (
      <div className="flex items-center gap-2">
        <Input
          value={name}
          onChange={e => setName(e.target.value)}
          className="h-8 text-lg font-bold w-48 sm:w-64"
          autoFocus
          onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") { setName(campaign.name); setEditing(false); } }}
        />
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={save}><Check className="h-4 w-4 text-primary" /></Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setName(campaign.name); setEditing(false); }}><X className="h-4 w-4" /></Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <h1 className="font-display text-lg sm:text-2xl font-bold truncate">{campaign.name}</h1>
      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setEditing(true)}><Pencil className="h-3.5 w-3.5 text-muted-foreground" /></Button>
      <Badge variant={status.variant}>{status.label}</Badge>
    </div>
  );
}


export default function Campaigns() {
  const { user } = useAuth();
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "" });

  const load = async () => {
    if (!user) return;
    const { data } = await supabase.from("campaigns").select("*").eq("user_id", user.id).order("created_at", { ascending: false });
    setCampaigns(data || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [user]);

  const handleCreate = async () => {
    if (!user || !form.name) return;
    const { error } = await supabase.from("campaigns").insert({
      user_id: user.id, name: form.name, status: "draft",
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Campaign created");
    setShowCreate(false);
    setForm({ name: "" });
    load();
  };

  const handleDuplicate = async (campaign: any) => {
    if (!user) return;
    const { data: newCamp, error } = await supabase.from("campaigns").insert({
      user_id: user.id, name: `${campaign.name} (copy)`, status: "draft",
      daily_limit: campaign.daily_limit, send_start_hour: campaign.send_start_hour,
      send_end_hour: campaign.send_end_hour, timezone: campaign.timezone,
      send_days: campaign.send_days, stop_on_reply: campaign.stop_on_reply,
      account_tags: campaign.account_tags,
    }).select().single();
    if (error) { toast.error(error.message); return; }

    // Copy steps with variants
    const { data: stps } = await supabase.from("campaign_steps").select("*").eq("campaign_id", campaign.id);
    if (stps?.length) {
      await supabase.from("campaign_steps").insert(
        stps.map((s: any) => ({
          campaign_id: newCamp.id, step_order: s.step_order,
          subject: s.subject, body: s.body, delay_days: s.delay_days,
          variants: s.variants,
        }))
      );
    }

    // Copy account assignments
    const { data: accs } = await supabase.from("campaign_accounts").select("account_id").eq("campaign_id", campaign.id);
    if (accs?.length) {
      await supabase.from("campaign_accounts").insert(
        accs.map((a: any) => ({ campaign_id: newCamp.id, account_id: a.account_id }))
      );
    }

    toast.success("Campaign duplicated");
    load();
  };

  const handleStatusToggle = async (campaign: any) => {
    const newStatus = campaign.status === "active" ? "paused" : "active";
    if (newStatus === "active") {
      const [{ data: ca }, { data: cl }, { data: st }] = await Promise.all([
        supabase.from("campaign_accounts").select("id").eq("campaign_id", campaign.id),
        supabase.from("campaign_leads").select("id").eq("campaign_id", campaign.id),
        supabase.from("campaign_steps").select("id").eq("campaign_id", campaign.id),
      ]);

      // Check accounts: direct assignments OR tag-based accounts
      let hasAccounts = (ca?.length || 0) > 0;
      if (!hasAccounts && (campaign.account_tags || []).length > 0) {
        const { data: tagAccounts } = await supabase
          .from("email_accounts")
          .select("id")
          .eq("status", "connected")
          .overlaps("tags", campaign.account_tags);
        hasAccounts = (tagAccounts?.length || 0) > 0;
      }

      if (!hasAccounts) { toast.error("Asigna al menos una cuenta de email o un tag con cuentas"); return; }
      if (!cl?.length) { toast.error("Asigna al menos un lead"); return; }
      if (!st?.length) { toast.error("Añade al menos un paso de email"); return; }
    }
    await supabase.from("campaigns").update({ status: newStatus }).eq("id", campaign.id);
    toast.success(`Campaign ${newStatus === "active" ? "activated" : "paused"}`);
    load();
  };

  const handleDelete = async (id: string) => {
    await supabase.from("campaign_steps").delete().eq("campaign_id", id);
    await supabase.from("campaign_accounts").delete().eq("campaign_id", id);
    await supabase.from("campaign_leads").delete().eq("campaign_id", id);
    await supabase.from("campaigns").delete().eq("id", id);
    toast.success("Campaign deleted");
    if (selectedId === id) setSelectedId(null);
    load();
  };

  if (loading) return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>;

  const selectedCampaign = campaigns.find(c => c.id === selectedId);

  // Campaign detail view
  if (selectedCampaign) {
    const status = statusConfig[selectedCampaign.status] || statusConfig.draft;
    return (
      <div className="space-y-4 sm:space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <Button variant="ghost" size="icon" className="shrink-0" onClick={() => setSelectedId(null)}>
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <div className="min-w-0">
              <EditableCampaignName campaign={selectedCampaign} onSaved={load} />
            </div>
          </div>
          <Button
            variant={selectedCampaign.status === "active" ? "secondary" : "default"}
            size="sm"
            className="gap-1.5 self-end sm:self-auto"
            onClick={() => handleStatusToggle(selectedCampaign)}
          >
            {selectedCampaign.status === "active" ? <><Pause className="h-4 w-4" /> Pause</> : <><Play className="h-4 w-4" /> {selectedCampaign.status === "draft" ? "Launch" : "Resume"}</>}
          </Button>
        </div>
        <CampaignReportBar campaign={selectedCampaign} />
        <CampaignDetail campaignId={selectedCampaign.id} />
      </div>
    );
  }

  // Campaign list view
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-xl sm:text-2xl font-bold">Campañas</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">Gestiona tus secuencias de cold email</p>
        </div>
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-2 self-end sm:self-auto"><Plus className="h-4 w-4" /> Nueva Campaña</Button>
          </DialogTrigger>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle className="font-display">Create campaign</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1"><Label>Campaign name</Label><Input value={form.name} onChange={e => setForm({ name: e.target.value })} placeholder="Q1 Outreach" /></div>
              <Button onClick={handleCreate} className="w-full" disabled={!form.name}>Create</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {campaigns.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Send className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="font-display font-semibold mb-2">No campaigns yet</h3>
            <p className="text-sm text-muted-foreground">Create your first cold email campaign.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {campaigns.map((campaign) => {
            const status = statusConfig[campaign.status] || statusConfig.draft;
            return (
              <Card key={campaign.id} className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => setSelectedId(campaign.id)}>
                <CardContent className="p-3 sm:p-5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-medium text-sm sm:text-base truncate">{campaign.name}</h3>
                        <Badge variant={status.variant} className="text-[10px] sm:text-xs">{status.label}</Badge>
                      </div>
                      <p className="text-[10px] sm:text-xs text-muted-foreground mt-1">
                        {new Date(campaign.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-0.5 shrink-0" onClick={e => e.stopPropagation()}>
                      <Button variant="ghost" size="icon" className="h-7 w-7 sm:h-8 sm:w-8" onClick={() => handleStatusToggle(campaign)}>
                        {campaign.status === "active" ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 sm:h-8 sm:w-8 hidden sm:flex" onClick={() => handleDuplicate(campaign)}>
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 sm:h-8 sm:w-8" onClick={() => handleDelete(campaign.id)}>
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  </div>
                  {/* Inline metrics */}
                  <div className="mt-3 border-t border-border/40 pt-3">
                    <CampaignMetricsInline campaignId={campaign.id} />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
