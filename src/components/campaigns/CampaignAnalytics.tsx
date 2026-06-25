import { useState, useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { BarChart3, Send, Mail, MessageSquare, Download, Share2, Loader2, Check } from "lucide-react";
import { toast } from "sonner";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";

interface Props { campaignId: string; }

export default function CampaignAnalytics({ campaignId }: Props) {
  const { user } = useAuth();
  const [stats, setStats] = useState({ started: 0, sent: 0, replied: 0, failed: 0 });
  const [stepStats, setStepStats] = useState<any[]>([]);
  const [campaignName, setCampaignName] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareEmail, setShareEmail] = useState("");
  const [shareOpen, setShareOpen] = useState(false);
  const analyticsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const load = async () => {
      const [leadsRes, sentRes, stepsRes, campaignRes] = await Promise.all([
        supabase.from("campaign_leads").select("id, status").eq("campaign_id", campaignId),
        supabase.from("sent_emails").select("id, status, campaign_step_id, replied_at").eq("campaign_id", campaignId),
        supabase.from("campaign_steps").select("id, step_order, subject").eq("campaign_id", campaignId).order("step_order"),
        supabase.from("campaigns").select("name").eq("id", campaignId).single(),
      ]);
      const leads = leadsRes.data || [];
      const emails = sentRes.data || [];
      const steps = stepsRes.data || [];
      setCampaignName(campaignRes.data?.name || "Campaña");

      setStats({
        started: leads.length,
        sent: emails.filter(e => e.status === "sent").length,
        replied: emails.filter(e => e.replied_at).length,
        failed: emails.filter(e => e.status === "failed").length,
      });

      setStepStats(steps.map(s => {
        const stepEmails = emails.filter(e => e.campaign_step_id === s.id);
        return {
          ...s,
          sent: stepEmails.filter(e => e.status === "sent").length,
          replied: stepEmails.filter(e => e.replied_at).length,
          failed: stepEmails.filter(e => e.status === "failed").length,
        };
      }));
    };
    load();
  }, [campaignId]);

  const captureAnalytics = async (): Promise<string> => {
    if (!analyticsRef.current) throw new Error("No analytics to capture");
    const canvas = await html2canvas(analyticsRef.current, {
      backgroundColor: "#ffffff",
      scale: 2,
      useCORS: true,
    });
    return canvas.toDataURL("image/png");
  };

  const handleDownloadPDF = async () => {
    setDownloading(true);
    try {
      const imgData = await captureAnalytics();
      const pdf = new jsPDF("landscape", "mm", "a4");
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();

      // Title
      pdf.setFontSize(18);
      pdf.text(`Analytics — ${campaignName}`, 14, 20);
      pdf.setFontSize(10);
      pdf.setTextColor(120);
      pdf.text(`Generado el ${new Date().toLocaleDateString("es", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })}`, 14, 28);

      // Image
      const imgWidth = pageWidth - 28;
      const imgHeight = (imgWidth * analyticsRef.current!.offsetHeight) / analyticsRef.current!.offsetWidth;
      const finalHeight = Math.min(imgHeight, pageHeight - 40);
      pdf.addImage(imgData, "PNG", 14, 35, imgWidth, finalHeight);

      pdf.save(`analytics-${campaignName.replace(/\s+/g, "-").toLowerCase()}.pdf`);
      toast.success("PDF descargado");
    } catch (e: any) {
      toast.error(`Error al generar PDF: ${e.message}`);
    }
    setDownloading(false);
  };

  const handleShareEmail = async () => {
    if (!shareEmail.trim() || !user) return;
    setSharing(true);
    try {
      const imgData = await captureAnalytics();
      const { data: { session } } = await supabase.auth.getSession();

      // Get first available email account to send from
      const { data: accounts } = await supabase
        .from("email_accounts")
        .select("id")
        .eq("user_id", user.id)
        .eq("status", "connected")
        .limit(1);

      if (!accounts || accounts.length === 0) {
        toast.error("No tienes cuentas de email conectadas para enviar");
        setSharing(false);
        return;
      }

      const replyRate = stats.sent > 0 ? ((stats.replied / stats.sent) * 100).toFixed(1) : "0";

      const htmlBody = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #1a1a1a;">📊 Analytics — ${campaignName}</h2>
          <p style="color: #666; font-size: 14px;">Informe generado el ${new Date().toLocaleDateString("es", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
          
          <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
            <tr>
              <td style="padding: 12px; text-align: center; border: 1px solid #eee;">
                <div style="font-size: 24px; font-weight: bold; color: #7c3aed;">${stats.started}</div>
                <div style="font-size: 12px; color: #888;">Sequences started</div>
              </td>
              <td style="padding: 12px; text-align: center; border: 1px solid #eee;">
                <div style="font-size: 24px; font-weight: bold; color: #22c55e;">${stats.sent}</div>
                <div style="font-size: 12px; color: #888;">Emails sent</div>
              </td>
              <td style="padding: 12px; text-align: center; border: 1px solid #eee;">
                <div style="font-size: 24px; font-weight: bold; color: #3b82f6;">${stats.replied}</div>
                <div style="font-size: 12px; color: #888;">Replies (${replyRate}%)</div>
              </td>
              <td style="padding: 12px; text-align: center; border: 1px solid #eee;">
                <div style="font-size: 24px; font-weight: bold; color: #ef4444;">${stats.failed}</div>
                <div style="font-size: 12px; color: #888;">Failed</div>
              </td>
            </tr>
          </table>

          ${stepStats.length > 0 ? `
            <h3 style="color: #1a1a1a; font-size: 14px;">Step Analytics</h3>
            <table style="width: 100%; border-collapse: collapse;">
              <tr style="background: #f5f5f5;">
                <th style="padding: 8px; text-align: left; font-size: 12px;">Step</th>
                <th style="padding: 8px; text-align: left; font-size: 12px;">Subject</th>
                <th style="padding: 8px; text-align: center; font-size: 12px;">Sent</th>
                <th style="padding: 8px; text-align: center; font-size: 12px;">Replies</th>
                <th style="padding: 8px; text-align: center; font-size: 12px;">Failed</th>
              </tr>
              ${stepStats.map(s => `
                <tr>
                  <td style="padding: 8px; font-size: 13px; border-bottom: 1px solid #eee;">Step ${s.step_order}</td>
                  <td style="padding: 8px; font-size: 13px; border-bottom: 1px solid #eee; color: #666;">${s.subject}</td>
                  <td style="padding: 8px; text-align: center; font-size: 13px; border-bottom: 1px solid #eee; color: #22c55e;">${s.sent}</td>
                  <td style="padding: 8px; text-align: center; font-size: 13px; border-bottom: 1px solid #eee; color: #3b82f6;">${s.replied}</td>
                  <td style="padding: 8px; text-align: center; font-size: 13px; border-bottom: 1px solid #eee; color: #ef4444;">${s.failed}</td>
                </tr>
              `).join("")}
            </table>
          ` : ""}

          <p style="margin-top: 24px; font-size: 12px; color: #aaa;">Enviado desde tu plataforma de cold email</p>
        </div>
      `;

      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({
          account_id: accounts[0].id,
          to_email: shareEmail.trim(),
          subject: `📊 Analytics — ${campaignName}`,
          body: htmlBody,
        }),
      });
      const result = await resp.json();
      if (result.error) toast.error(result.error);
      else {
        toast.success(`Analytics enviadas a ${shareEmail}`);
        setShareEmail("");
        setShareOpen(false);
      }
    } catch (e: any) {
      toast.error(`Error: ${e.message}`);
    }
    setSharing(false);
  };

  const metricCards = [
    { label: "Sequences started", value: stats.started, icon: BarChart3, color: "text-primary" },
    { label: "Emails sent", value: stats.sent, icon: Send, color: "text-success" },
    { label: "Replies", value: stats.replied, icon: MessageSquare, color: "text-info" },
    { label: "Failed", value: stats.failed, icon: Mail, color: "text-destructive" },
  ];

  const replyRate = stats.sent > 0 ? ((stats.replied / stats.sent) * 100).toFixed(1) : "0";

  return (
    <div className="space-y-6">
      {/* Share / Download actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-muted-foreground">
            Reply rate: <span className="text-foreground text-base font-bold">{replyRate}%</span>
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs"
            onClick={handleDownloadPDF}
            disabled={downloading}
          >
            {downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            Descargar PDF
          </Button>
          <Popover open={shareOpen} onOpenChange={setShareOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5 text-xs">
                <Share2 className="h-3.5 w-3.5" />
                Compartir
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-3" align="end">
              <p className="text-xs font-medium mb-2">Enviar analytics por email</p>
              <div className="flex gap-2">
                <Input
                  placeholder="email@ejemplo.com"
                  className="h-8 text-sm"
                  value={shareEmail}
                  onChange={e => setShareEmail(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleShareEmail()}
                />
                <Button
                  size="sm"
                  className="h-8 gap-1.5"
                  onClick={handleShareEmail}
                  disabled={sharing || !shareEmail.trim()}
                >
                  {sharing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground mt-2">Se enviará un informe HTML con todas las métricas de la campaña</p>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* Analytics content - captured for PDF */}
      <div ref={analyticsRef}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {metricCards.map(m => (
            <Card key={m.label}>
              <CardContent className="p-4 text-center">
                <m.icon className={`h-5 w-5 mx-auto mb-2 ${m.color}`} />
                <p className="text-2xl font-bold">{m.value}</p>
                <p className="text-xs text-muted-foreground">{m.label}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {stepStats.length > 0 && (
          <div className="mt-6">
            <h4 className="text-sm font-semibold mb-3">Step Analytics</h4>
            <div className="space-y-2">
              {stepStats.map(s => (
                <div key={s.id} className="flex items-center gap-4 rounded-lg border p-3 text-sm">
                  <span className="font-medium text-primary">Step {s.step_order}</span>
                  <span className="flex-1 truncate text-muted-foreground">{s.subject}</span>
                  <span className="text-success">{s.sent} sent</span>
                  <span className="text-info">{s.replied} replies</span>
                  <span className="text-destructive">{s.failed} failed</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
